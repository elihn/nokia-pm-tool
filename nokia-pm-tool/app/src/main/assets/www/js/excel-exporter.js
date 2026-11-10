// Excel Exporter using ExcelJS
// Respecte scrupuleusement l'ordre obligatoire en 6 étapes :
// 1) Charger le template importé avec ExcelJS.
// 2) Appliquer les modifications de structure (insertion de lignes, fusions, décalage signatures, printArea, nouvelles feuilles).
// 3) Renuméroter les items et mettre à jour "Page x/y".
// 4) Écrire les valeurs texte et choix OK / NOT OK / NA.
// 5) EN DERNIER : insérer les images (photos, captures, signatures) avec dimensionnement et centrage dans les cellules Excel.
// 6) Télécharger PM_<Site>_<Hop>_<date>.xlsx et proposer le partage (WhatsApp, e-mail, Drive).

class ExcelExporter {
  constructor() {}

  // Convert column letter to 1-based index (A -> 1, Z -> 26, AA -> 27)
  static colLetterToIndex(colStr) {
    let index = 0;
    const str = colStr.toUpperCase();
    for (let i = 0; i < str.length; i++) {
      index = index * 26 + (str.charCodeAt(i) - 64);
    }
    return index;
  }

  // Convert 1-based index to column letter
  static indexToColLetter(colIdx) {
    let temp = colIdx;
    let letter = '';
    while (temp > 0) {
      const rem = (temp - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  }

  // Parse Excel range e.g. "A27:C27" or single cell "D1"
  static parseRange(rangeStr) {
    const parts = rangeStr.split(':');
    const parseCell = (cellStr) => {
      const match = cellStr.match(/^([A-Z]+)(\d+)$/i);
      if (!match) return { col: 1, row: 1 };
      return {
        col: ExcelExporter.colLetterToIndex(match[1]),
        row: parseInt(match[2], 10)
      };
    };

    const tl = parseCell(parts[0]);
    const br = parts[1] ? parseCell(parts[1]) : { col: tl.col, row: tl.row };
    return {
      top: Math.min(tl.row, br.row),
      left: Math.min(tl.col, br.col),
      bottom: Math.max(tl.row, br.row),
      right: Math.max(tl.col, br.col)
    };
  }
    // Retourne la plage fusionnée contenant la cellule, sinon la cellule seule
  static getCellRange(ws, row, col) {
    const merges = (ws.model && ws.model.merges) || [];
    for (const m of merges) {
      const r = ExcelExporter.parseRange(m);
      if (row >= r.top && row <= r.bottom && col >= r.left && col <= r.right) return r;
    }
    return { top: row, left: col, bottom: row, right: col };
  }
  // Remplace la valeur d'une cellule en conservant son libellé ("Site Name:", "Client Name:"...)
  static setLabeled(cell, value) {
    const old = cell.value;
    let text = '';
    if (old && typeof old === 'object') {
      if (old.richText) text = old.richText.map(t => t.text).join('');
      else if (old.text) text = String(old.text);
      else if (old.result !== undefined) text = String(old.result);
    } else if (old !== null && old !== undefined) {
      text = String(old);
    }
    const m = text.match(/^([A-Za-zÀ-ÿ0-9_\[\]\s\/\.\-]{1,40}[:=])\s*/);
    cell.value = m ? `${m[1]} ${value}` : String(value);
  }
    // Date saisie ("06-Nov-2026", "06/11/2026", "2026-11-06"...) → Date UTC, ou null
  static parseDate(text) {
    if (!text) return null;
    const s = String(text).trim();
    const monthIndex = (w) => {
      const x = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (x.startsWith('juil') || x.startsWith('jul')) return 6;
      if (x.startsWith('juin') || x.startsWith('jun')) return 5;
      const t = { jan: 0, fev: 1, feb: 1, mar: 2, avr: 3, apr: 3, mai: 4, may: 4,
                  aou: 7, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      return t[x.slice(0, 3)];
    };
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if ((m = s.match(/^(\d{1,2})[\s\-\/]([A-Za-zéûÉ]{3,5})\.?[\s\-\/](\d{4})$/))) {
      const mo = monthIndex(m[2]);
      if (mo !== undefined) return new Date(Date.UTC(+m[3], mo, +m[1]));
    }
    return null;
  }

  static fmtDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  // Écrit la date : vraie date Excel si la cellule en contient une, sinon texte jj/mm/aaaa
  // en gardant le libellé ("DATE : 06/11/2026")
  static writeDate(cell, dateText) {
    const d = ExcelExporter.parseDate(dateText);
    if (!d) { ExcelExporter.setLabeled(cell, String(dateText)); return; }
    if (cell.value instanceof Date) cell.value = d;
    else ExcelExporter.setLabeled(cell, ExcelExporter.fmtDate(d));
  }
  // Calculate pixel dimensions of a target cell or merged range based on Excel column widths and row heights
  // Formula required:
  // widthPx = somme des largeurs de colonnes : Math.round(width * 7 + 5) par colonne (si width non définie, 8.43)
  // heightPx = somme des hauteurs de lignes : (height * 96) / 72 par ligne (si height non définie, 15)
  static getRangePixelDimensions(ws, topRow, leftCol, bottomRow, rightCol) {
    let widthPx = 0;
    const colWidthsPx = [];
    for (let c = leftCol; c <= rightCol; c++) {
      const colWidth = (ws.getColumn(c) && ws.getColumn(c).width !== undefined) ? ws.getColumn(c).width : 8.43;
      const px = Math.round(colWidth * 7 + 5);
      colWidthsPx.push(px);
      widthPx += px;
    }

    let heightPx = 0;
    const rowHeightsPx = [];
    for (let r = topRow; r <= bottomRow; r++) {
      const rowHeight = (ws.getRow(r) && ws.getRow(r).height !== undefined) ? ws.getRow(r).height : 15;
      const px = (rowHeight * 96) / 72;
      rowHeightsPx.push(px);
      heightPx += px;
    }

    return {
      width: Math.max(20, widthPx),
      height: Math.max(20, heightPx),
      firstColWidth: colWidthsPx[0] || 64,
      firstRowHeight: rowHeightsPx[0] || 20
    };
  }

  // Get image natural dimensions from base64 string
  static async getImageDimensions(base64Data) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth || 800, height: img.naturalHeight || 600 });
      };
      img.onerror = () => {
        resolve({ width: 800, height: 600 });
      };
      img.src = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
    });
  }

  // Center-crop image to target aspect ratio for "fill" (Remplir la cellule) mode
  static async cropImageToAspectRatio(base64Data, targetRatio) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const natW = img.naturalWidth || 800;
        const natH = img.naturalHeight || 600;
        const currentRatio = natW / natH;

        let cropW = natW;
        let cropH = natH;
        let cropX = 0;
        let cropY = 0;

        if (currentRatio > targetRatio) {
          // Source is wider than target -> crop horizontally
          cropW = Math.round(natH * targetRatio);
          cropX = Math.round((natW - cropW) / 2);
        } else {
          // Source is taller than target -> crop vertically
          cropH = Math.round(natW / targetRatio);
          cropY = Math.round((natH - cropH) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        resolve({
          base64: croppedBase64,
          cleanBase64: croppedBase64.replace(/^data:image\/\w+;base64,/, '')
        });
      };
      img.onerror = () => {
        resolve({
          base64: base64Data,
          cleanBase64: base64Data.replace(/^data:image\/\w+;base64,/, '')
        });
      };
      img.src = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
    });
  }

  // ==========================================
  // Main Generation Pipeline (Étapes 1 à 6)
  // ==========================================
  async generateReport(originalArrayBuffer, structure, formData, options = {}) {
    if (!window.ExcelJS) {
      throw new Error("Erreur technique : La bibliothèque ExcelJS n'est pas disponible.");
    }

    // -------------------------------------------------------------
    // ÉTAPE 1 : Charger le template importé avec ExcelJS
    // -------------------------------------------------------------
    const workbook = new window.ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(originalArrayBuffer);
    } catch (loadErr) {
      throw new Error("Fichier invalide : Impossible de charger le classeur Excel d'origine.");
    }

    const common = formData.common || {};
    const coverData = formData.cover || {};
    const radioData = formData.radio || {};
    const inspectionData = formData.inspections || {};
    const monitoringData = formData.monitoring || {};
    const geotagData = formData.geotags || {};
    const signatures = formData.signatures || {};
    const freeGridEdits = formData.freeGridEdits || {};
    const keepInstruction = options.keepInstructionText || false;
    const photoFitMode = options.photoFitMode || 'fit'; // 'fit' (default), 'fill', 'stretch'

    // -------------------------------------------------------------
    // ÉTAPE 2 : Appliquer les modifications de structure
    // -------------------------------------------------------------
    // 2.A) Nouvelles feuilles dupliquées : copier cellules, styles, fusions, mise en page
    for (const sheetDef of structure.sheets) {
      if (sheetDef.isDuplicated && !workbook.getWorksheet(sheetDef.name)) {
        this.cloneWorksheet(workbook, sheetDef.sourceSheetName, sheetDef.name);
      }
    }

    // 2.B) Masquer les feuilles supprimées/masquées par l'utilisateur
    structure.sheets.forEach(sheetDef => {
      if (sheetDef.hidden) {
        const ws = workbook.getWorksheet(sheetDef.name);
        if (ws) ws.state = 'hidden';
      }
    });

    // 2.C) Insertions de lignes ajoutées (Custom items) avec gestion des fusions & printArea
    for (const sheetDef of structure.sheets) {
      if (sheetDef.hidden) continue;
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws) continue;

      this.applyRowInsertionsAndMerges(ws, sheetDef);
    }

    // -------------------------------------------------------------
    // ÉTAPE 3 : Renuméroter les items et mettre à jour "Page x/y"
    // -------------------------------------------------------------
    this.updatePaginationAndItemNumbers(workbook, structure);

    // -------------------------------------------------------------
    // ÉTAPE 4 : Écrire les valeurs texte et choix OK / NOT OK / NA
    // -------------------------------------------------------------
    // 4.A) En-têtes communs sur toutes les feuilles
    this.writeCommonHeaders(workbook, structure, common);

    // 4.B) Cartouche Signatures (Noms, contacts, date)
    this.writeSignatureBlockTexts(workbook, structure, common);

    // 4.C) Données des feuilles spécialisées
    for (const sheetDef of structure.sheets) {
      if (sheetDef.hidden) continue;
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws) continue;

      switch (sheetDef.type) {
        case 'COVER':
          this.fillCoverSheet(ws, sheetDef.content, common, coverData);
          break;

        case 'RADIO_CONFIG':
          this.fillRadioConfigSheet(ws, sheetDef.content, radioData);
          break;

        case 'PHYSICAL_INSPECTION':
          this.fillPhysicalInspectionSheet(ws, sheetDef.content, inspectionData);
          break;

        default:
          break;
      }

      // Appliquer les éditions manuelles en Mode Libre
      const customEdits = freeGridEdits[sheetDef.name];
      if (customEdits) {
        for (const [coord, val] of Object.entries(customEdits)) {
          if (typeof val === 'string' && !val.startsWith('data:image')) {
            const [rStr, cStr] = coord.split('_');
            const r = parseInt(rStr, 10);
            const c = parseInt(cStr, 10);
            ws.getRow(r).getCell(c).value = val;
          }
        }
      }
    }

    // -------------------------------------------------------------
    // ÉTAPE 5 : EN DERNIER - Insérer les images (photos, captures, signatures)
    // Insertion strictement EN DERNIER après toutes les modifications de structure
    // Respecte le mode d'ajustement choisi : 'fit', 'fill', ou 'stretch'
    // Centrage avec décalages décimaux sur tl { col, row } et editAs: 'oneCell'
    // -------------------------------------------------------------
    for (const sheetDef of structure.sheets) {
      if (sheetDef.hidden) continue;
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws) continue;

      // 5.A) Photos Geotag
      if (sheetDef.type === 'GEOTAG_PHOTO_REPORT') {
        await this.embedGeotagImages(workbook, ws, sheetDef.content, geotagData, keepInstruction, photoFitMode);
      }

      // 5.B) Captures d'écran Monitoring
      if (sheetDef.type === 'MONITORING') {
        await this.embedMonitoringImages(workbook, ws, sheetDef.content, monitoringData, photoFitMode);
      }

      // 5.C) Signatures tactiles (FOE, Expert Partenaire, Airtel)
      await this.embedSignatures(workbook, ws, sheetDef.signatureBlock, signatures);

      // 5.D) Photos insérées en Mode Libre
      const customEdits = freeGridEdits[sheetDef.name];
      if (customEdits) {
        for (const [coord, val] of Object.entries(customEdits)) {
          if (typeof val === 'string' && val.startsWith('data:image')) {
            const [rStr, cStr] = coord.split('_');
            await this.embedSingleCellImage(workbook, ws, parseInt(rStr, 10), parseInt(cStr, 10), val, photoFitMode);
          }
        }
      }
    }

    // Générer le tampon binaire Excel
    const outputBuffer = await workbook.xlsx.writeBuffer();
    return outputBuffer;
  }

  // ==========================================
  // Cloner une feuille modèle
  // ==========================================
  cloneWorksheet(workbook, sourceName, newName) {
    const sourceWs = workbook.getWorksheet(sourceName);
    if (!sourceWs) return null;

    const newWs = workbook.addWorksheet(newName);

    // Copier largeurs de colonnes
    if (sourceWs.columns) {
      sourceWs.columns.forEach((col, idx) => {
        if (col && newWs.columns && newWs.columns[idx]) {
          newWs.columns[idx].width = col.width;
        }
      });
    }

    // Copier lignes, hauteurs et styles de cellules
    sourceWs.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const newRow = newWs.getRow(rowNumber);
      newRow.height = row.height;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const newCell = newRow.getCell(colNumber);
        newCell.value = cell.value;
        if (cell.style) {
          try {
            newCell.style = JSON.parse(JSON.stringify(cell.style));
          } catch (e) {}
        }
      });
    });

    // Copier les fusions
    const merges = sourceWs.model?.merges || [];
    merges.forEach(rangeStr => {
      try {
        newWs.mergeCells(rangeStr);
      } catch (e) {}
    });

    // Copier mise en page
    if (sourceWs.pageSetup) {
      try {
        newWs.pageSetup = JSON.parse(JSON.stringify(sourceWs.pageSetup));
      } catch (e) {}
    }

    return newWs;
  }

  // ==========================================
  // Gestion précise des insertions de lignes et décalage des fusions
  // ==========================================
  applyRowInsertionsAndMerges(ws, sheetDef) {
    if (!sheetDef.content?.items) return;

    // Détecter les items ajoutés par l'utilisateur
    const addedItems = sheetDef.content.items.filter(it => it.id && it.id.startsWith('custom_'));
    if (addedItems.length === 0) return;

    // Point d'insertion : juste avant le bloc de signatures
    const sigStartRow = sheetDef.signatureBlock?.foeNameCell?.row || (ws.rowCount - 6);
    const addedCount = addedItems.length;

    // 1. Lister les fusions situées sous le point d'insertion
    const existingMerges = (ws.model?.merges || []).slice();
    const shiftedMerges = [];

    existingMerges.forEach(rangeStr => {
      const range = ExcelExporter.parseRange(rangeStr);
      if (range.top >= sigStartRow) {
        try {
          ws.unMergeCells(rangeStr);
        } catch (e) {}
        shiftedMerges.push({
          top: range.top + addedCount,
          left: range.left,
          bottom: range.bottom + addedCount,
          right: range.right
        });
      }
    });

    // 2. Insérer les lignes avec copie du style de la ligne modèle
    const modelRowNumber = sigStartRow - 1;
    const modelRow = ws.getRow(modelRowNumber);
    const modelHeight = modelRow.height || 18;

    for (let i = 0; i < addedCount; i++) {
      const insertAt = sigStartRow + i;
      const targetRow = ws.getRow(insertAt);
      targetRow.height = modelHeight;

      modelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const newCell = targetRow.getCell(colNumber);
        if (cell.style) {
          try {
            newCell.style = JSON.parse(JSON.stringify(cell.style));
          } catch (e) {}
        }
      });
    }

    // 3. Refusionner les plages décalées sous le point d'insertion
    shiftedMerges.forEach(m => {
      const startLetter = ExcelExporter.indexToColLetter(m.left);
      const endLetter = ExcelExporter.indexToColLetter(m.right);
      try {
        ws.mergeCells(`${startLetter}${m.top}:${endLetter}${m.bottom}`);
      } catch (e) {}
    });

    // Étendre la zone d'impression (printArea)
    if (ws.pageSetup && ws.pageSetup.printArea) {
      const currentArea = ws.pageSetup.printArea;
      const match = currentArea.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
      if (match) {
        const newBottom = parseInt(match[4], 10) + addedCount;
        ws.pageSetup.printArea = `${match[1]}${match[2]}:${match[3]}${newBottom}`;
      }
    }
  }

  // ==========================================
  // ÉTAPE 3 : Pagination et renumérotation
  // ==========================================
  updatePaginationAndItemNumbers(workbook, structure) {
    const activeSheets = structure.sheets.filter(s => !s.hidden);
    const totalPages = activeSheets.length;

    activeSheets.forEach((sheetDef, index) => {
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws) return;

      const pageNumber = index + 1;
      const pageText = `Page ${pageNumber}/${totalPages}`;

      // Recherche de cellule contenant "Page " ou "PAGE "
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (typeof cell.value === 'string' && /page\s*\d+\s*\/\s*\d+/i.test(cell.value)) {
            cell.value = cell.value.replace(/page\s*\d+\s*\/\s*\d+/i, pageText);
          }
        });
      });

      // Renuméroter les items
      if (sheetDef.content?.items) {
        sheetDef.content.items.forEach((item, itIdx) => {
          if (item.noCell) {
            const noCell = ws.getRow(item.noCell.row).getCell(item.noCell.col);
            noCell.value = itIdx + 1;
          }
        });
      }
    });
  }
    // En-tête de la feuille Radio config : le libellé et la valeur sont dans des cellules séparées
  writeRadioHeader(ws, common) {
    const rules = [
      { re: /^project(?:\s*name)?\s*[:]/i,   value: common.projectName },
      { re: /^site\s*name\s*[:]/i,           value: common.siteName },
      { re: /^client(?:\s*name)?\s*[:]/i,    value: common.client },
      { re: /^country(?:\s*name)?\s*[:]/i,   value: common.country },
      { re: /^partner(?:\s*name)?\s*[:]/i,   value: common.partner },
      { re: /^hop(?:\s*name)?\s*[:]/i,       value: common.hopName }
    ];
    const asText = (cell) => {
      const v = cell.value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') {
        if (v.richText) return v.richText.map(t => t.text).join('');
        if (v.text) return String(v.text);
        if (v.result !== undefined) return String(v.result);
        return '';
      }
      return String(v);
    };

    for (let r = 1; r <= 4; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= 24; c++) {
        const cell = row.getCell(c);
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;

        const text = asText(cell).trim();
        if (!text || !text.includes(':')) continue;
        const rule = rules.find(x => x.re.test(text));
        if (!rule || !rule.value) continue;

        const m = text.match(/^([^:]+:)\s*(.*)$/);
        if (m && m[2].trim().length > 0) {
          // libellé et valeur dans la même cellule : "Site Name: XXX"
          const prefix = m[1];
          cell.value = `${prefix} ${rule.value}`;
        } else {
          // libellé seul : la valeur est dans la première cellule remplie à sa droite
          let target = null;
          for (let k = c + 1; k <= Math.min(c + 8, 24); k++) {
            const targetCell = row.getCell(k);
            if (targetCell.isMerged && targetCell.master && targetCell.master.address !== targetCell.address) continue;
            const t = asText(targetCell).trim();
            if (t && rules.some(r => r.re.test(t))) break;
            if (t) { target = targetCell; break; }
          }
          if (!target) {
            target = row.getCell(c + 1);
          }
          target.value = String(rule.value);
          c = Math.max(c, target.col);
        }
      }
    }
  }

  // ==========================================
  // ÉTAPE 4 : Écriture des données texte
  // ==========================================
  writeCommonHeaders(workbook, structure, common) {
    structure.sheets.forEach(sheetDef => {
      if (sheetDef.hidden) return;
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws) return;

      // Feuille Radio config : traitement dédié
      if (sheetDef.type === 'RADIO_CONFIG') {
        this.writeRadioHeader(ws, common);
        return;
      }
      if (!sheetDef.commonHeader) return;

      const ch = sheetDef.commonHeader;
      const set = (pos, value) => {
        if (!pos || value === undefined || value === null || value === '') return;
        ExcelExporter.setLabeled(ws.getRow(pos.row).getCell(pos.col), value);
      };
      set(ch.siteNameCell, common.siteName);
      set(ch.hopNameCell, common.hopName);
      set(ch.clientCell, common.client);
      set(ch.partnerCell, common.partner);
      set(ch.countryCell, common.country);
      set(ch.projectCell, common.projectName);
      if (ch.dateCell && common.date) {
        ExcelExporter.writeDate(ws.getRow(ch.dateCell.row).getCell(ch.dateCell.col), common.date);
      }
    });
  }

  writeSignatureBlockTexts(workbook, structure, common) {
    structure.sheets.forEach(sheetDef => {
      if (sheetDef.hidden) return;
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws || !sheetDef.signatureBlock) return;

      const sig = sheetDef.signatureBlock;
      const set = (pos, value) => {
        if (pos && value) ExcelExporter.setLabeled(ws.getRow(pos.row).getCell(pos.col), value);
      };
      set(sig.foeNameCell, common.foeName);
      set(sig.foeContactCell, common.foeContact);
      if (sig.foeDateCell && common.date) {
        ExcelExporter.writeDate(ws.getRow(sig.foeDateCell.row).getCell(sig.foeDateCell.col), common.date);
      }
    });
  }

  fillCoverSheet(ws, coverDef, common, coverData) {
    const f = coverDef.fields || {};
    const cellOf = (pos) => ws.getRow(pos.row).getCell(pos.col);
    const put = (pos, v) => {
      if (!pos || v === undefined || v === null || String(v).trim() === '') return;
      if (pos.inline === false) cellOf(pos).value = String(v);   // valeur seule
      else ExcelExporter.setLabeled(cellOf(pos), v);             // "Libellé: valeur"
    };
    put(f.siteLong, common.siteLong);
    put(f.siteLat, common.siteLat);
    put(f.siteAName, common.siteA);
    put(f.siteBName, common.siteB);
    put(f.note, common.ttRef);
    put(f.pmDesc, common.pmDescription);
    put(f.hopName, common.hopName);
    if (f.date && common.date) ExcelExporter.writeDate(cellOf(f.date), common.date);

    // Link Status Evaluation Options
    const opt = coverData.linkStatusOption || 'fine';
    const ls = coverDef.linkStatusRows || {
      workingFine: coverDef.linkStatusModel?.fineOption,
      minorSnags: coverDef.linkStatusModel?.minorOption,
      majorAlarms: coverDef.linkStatusModel?.majorOption
    };

    // Reset status cells first
    if (ls.workingFine?.row && ls.workingFine?.valueCol) {
      ws.getRow(ls.workingFine.row).getCell(ls.workingFine.valueCol).value = '';
    }
    if (ls.minorSnags?.row) {
      const vCol = ls.minorSnags.valueCol || (ls.minorSnags.itemsCountTarget ? ls.minorSnags.itemsCountTarget.col + 2 : 7);
      ws.getRow(ls.minorSnags.row).getCell(vCol).value = '';
    }
    if (ls.majorAlarms?.row) {
      const vCol = ls.majorAlarms.valueCol || (ls.majorAlarms.itemsCountTarget ? ls.majorAlarms.itemsCountTarget.col + 2 : 7);
      ws.getRow(ls.majorAlarms.row).getCell(vCol).value = '';
    }

    if (opt === 'fine' && ls.workingFine) {
      const col = ls.workingFine.valueCol || ls.workingFine.col || 7;
      ws.getRow(ls.workingFine.row).getCell(col).value = 'YES';
    } else if (opt === 'minor' && ls.minorSnags) {
      const col = ls.minorSnags.valueCol || ls.minorSnags.col || 7;
      ws.getRow(ls.minorSnags.row).getCell(col).value = 'YES';
      if (ls.minorSnags.itemsCountTarget) {
        ws.getRow(ls.minorSnags.itemsCountTarget.row).getCell(ls.minorSnags.itemsCountTarget.col).value = coverData.minorSnagsItemsCount || 0;
      }
      if (ls.minorSnags.pageNoTarget) {
        ws.getRow(ls.minorSnags.pageNoTarget.row).getCell(ls.minorSnags.pageNoTarget.col).value = coverData.minorSnagsPageNo || '';
      }
    } else if (opt === 'major' && ls.majorAlarms) {
      const col = ls.majorAlarms.valueCol || ls.majorAlarms.col || 7;
      ws.getRow(ls.majorAlarms.row).getCell(col).value = 'YES';
      if (ls.majorAlarms.itemsCountTarget) {
        ws.getRow(ls.majorAlarms.itemsCountTarget.row).getCell(ls.majorAlarms.itemsCountTarget.col).value = coverData.majorAlarmsItemsCount || 0;
      }
      if (ls.majorAlarms.pageNoTarget) {
        ws.getRow(ls.majorAlarms.pageNoTarget.row).getCell(ls.majorAlarms.pageNoTarget.col).value = coverData.majorAlarmsPageNo || '';
      }
    }
  }

  fillRadioConfigSheet(ws, radioDef, radioData) {
    const f = radioDef.configFields || {};
    const val = radioData.configValues || {};

    const formatField = (key, rawVal, prefix) => {
      const v = String(rawVal || '').trim();
      if (!v) return prefix ? prefix.trim() : '';
      if (prefix) {
        const cleanPrefix = prefix.trim();
        if (v.toLowerCase().startsWith(cleanPrefix.toLowerCase())) return v;
        return `${cleanPrefix} ${v}`;
      }
      return v;
    };

    for (const [key, target] of Object.entries(f)) {
      if (!target) continue;
      const cell = ws.getRow(target.row).getCell(target.col);

      if (key === 'siteHigh') {
        const hVal = (val.siteHigh !== undefined ? val.siteHigh : target.initialValue || '').trim();
        cell.value = hVal ? (hVal.toLowerCase().includes('site high') ? hVal : `Site High: ${hVal}`) : 'Site High:';
        continue;
      }
      if (key === 'siteLow') {
        const lVal = (val.siteLow !== undefined ? val.siteLow : target.initialValue || '').trim();
        cell.value = lVal ? (lVal.toLowerCase().includes('site low') ? lVal : `Site Low: ${lVal}`) : 'Site Low:';
        continue;
      }

      const userVal = val[key];
      if (userVal !== undefined && userVal !== null && userVal !== '') {
        cell.value = target.inline ? formatField(key, userVal, target.prefix) : userVal;
      }
    }

    // Ensure port column headers exist (for dynamically added ports)
    if (radioDef.testTable?.columns?.portCols && radioDef.testTable?.headerRow) {
      radioDef.testTable.columns.portCols.forEach(p => {
        const hRow = ws.getRow(radioDef.testTable.headerRow + 1);
        const hCell = hRow.getCell(p.col);
        if (!hCell.value) hCell.value = p.label;
      });
    }

    const userTests = radioData.tests || {};
    if (radioDef.testTable?.tests) {
      radioDef.testTable.tests.forEach(test => {
        const row = ws.getRow(test.row);
        // Write test metadata if new row
        if (test.item && radioDef.testTable.columns?.itemCol) {
          const itemCell = row.getCell(radioDef.testTable.columns.itemCol);
          if (!itemCell.value) itemCell.value = test.item;
        }
        if (test.no && radioDef.testTable.columns?.noCol) {
          const noCell = row.getCell(radioDef.testTable.columns.noCol);
          if (!noCell.value) noCell.value = test.no;
        }
        if (test.spec && radioDef.testTable.columns?.specCol) {
          const specCell = row.getCell(radioDef.testTable.columns.specCol);
          if (!specCell.value) specCell.value = test.spec;
        }
        if (test.equipment && radioDef.testTable.columns?.equipCol) {
          const eqCell = row.getCell(radioDef.testTable.columns.equipCol);
          if (!eqCell.value) eqCell.value = test.equipment;
        }

        const portMap = userTests[test.no] || {};
        for (const [pLabel, pInfo] of Object.entries(test.ports || {})) {
          if (portMap[pLabel] !== undefined) {
            row.getCell(pInfo.col).value = portMap[pLabel];
          }
        }
      });
    }
  }

  fillPhysicalInspectionSheet(ws, inspectionDef, inspectionData) {
    if (!inspectionDef.items) return;

    inspectionDef.items.forEach(item => {
      const entry = inspectionData[item.id];
      if (!entry) return;

      const row = ws.getRow(item.row);
      const cols = item.cols;

      if (entry.status === 'OK') {
        row.getCell(cols.okCol).value = 'OK';
        row.getCell(cols.notOkCol).value = '';
      } else if (entry.status === 'NOT OK') {
        row.getCell(cols.notOkCol).value = 'NOT OK';
        row.getCell(cols.okCol).value = '';
      } else if (entry.status === 'NA') {
        row.getCell(cols.okCol).value = 'NA';
        row.getCell(cols.notOkCol).value = '';
      }

      if (entry.detail !== undefined) row.getCell(cols.detailCol).value = entry.detail;
      if (entry.comment !== undefined) row.getCell(cols.commentCol).value = entry.comment;
    });
  }

  // ==========================================
  // ÉTAPE 5 : Insertion proportionnelle & centrée des images (EN DERNIER)
  // ==========================================
  async embedGeotagImages(workbook, ws, geotagDef, geotagData, keepInstruction, photoFitMode = 'fit') {
    if (!geotagDef?.items) return;

    for (const item of geotagDef.items) {
      if (!item.slots) continue;

      for (const slot of item.slots) {
        const slotKey = `${item.id}_s${slot.slotIndex}`;
        const photoBase64 = geotagData[slotKey];

        // Emplacements sans photo : restent inchangés avec leur consigne
        if (!photoBase64) continue;

        try {
          const range = ExcelExporter.getCellRange(ws, slot.row, slot.col);
          const topRow = range.top;
          const leftCol = range.left;
          const bottomRow = range.bottom;
          const rightCol = range.right;

          // Si l'utilisateur NE souhaite PAS garder le texte de consigne, la photo le recouvre (par défaut)
          if (!keepInstruction) {
            ws.getRow(topRow).getCell(leftCol).value = '';
          }

          // Calcul des dimensions de la cellule cible en pixels
          const targetBox = ExcelExporter.getRangePixelDimensions(ws, topRow, leftCol, bottomRow, rightCol);
          let naturalDim = await ExcelExporter.getImageDimensions(photoBase64);
          let cleanBase64 = photoBase64.replace(/^data:image\/\w+;base64,/, '');

          let renderWidth = targetBox.width;
          let renderHeight = targetBox.height;
          let offsetX_px = 0;
          let offsetY_px = 0;

          if (photoFitMode === 'fit') {
            // Mode a) Ajuster sans déformer (par défaut) :
            // Image entière visible, centrée, marge de 3px
            const margin = 3;
            const usableWidth = Math.max(10, targetBox.width - (margin * 2));
            const usableHeight = Math.max(10, targetBox.height - (margin * 2));
            const scale = Math.min(usableWidth / naturalDim.width, usableHeight / naturalDim.height);

            renderWidth = Math.round(naturalDim.width * scale);
            renderHeight = Math.round(naturalDim.height * scale);
            offsetX_px = Math.round((targetBox.width - renderWidth) / 2);
            offsetY_px = Math.round((targetBox.height - renderHeight) / 2);
          } else if (photoFitMode === 'fill') {
            // Mode b) Remplir la cellule :
            // Recadrage centré couvrant toute la cellule
            const targetRatio = targetBox.width / targetBox.height;
            const cropped = await ExcelExporter.cropImageToAspectRatio(photoBase64, targetRatio);
            cleanBase64 = cropped.cleanBase64;
            renderWidth = targetBox.width;
            renderHeight = targetBox.height;
            offsetX_px = 0;
            offsetY_px = 0;
          } else if (photoFitMode === 'stretch') {
            // Mode c) Étirer :
            // Dimensions exactes de la cellule, déformation acceptée
            renderWidth = targetBox.width;
            renderHeight = targetBox.height;
            offsetX_px = 0;
            offsetY_px = 0;
          }

          const imageId = workbook.addImage({ base64: cleanBase64, extension: 'jpeg' });

          // Calcul des offsets décimaux pour centrage
          const decimalColOffset = Math.max(0, offsetX_px / targetBox.firstColWidth);
          const decimalRowOffset = Math.max(0, offsetY_px / targetBox.firstRowHeight);

          ws.addImage(imageId, {
            tl: {
              col: (leftCol - 1) + decimalColOffset,
              row: (topRow - 1) + decimalRowOffset
            },
            ext: {
              width: renderWidth,
              height: renderHeight
            },
            editAs: 'oneCell'
          });
        } catch (e) {
          console.warn('Erreur insertion photo Geotag:', e);
        }
      }
    }
  }

  async embedMonitoringImages(workbook, ws, monDef, monitoringData, photoFitMode = 'fit') {
    if (!monDef?.items) return;

    for (const item of monDef.items) {
      const photoBase64 = monitoringData[item.id];
      if (!photoBase64) continue;

      try {
        const range = ExcelExporter.getCellRange(ws, item.row, item.targetCol);
        const topRow = range.top;
        const leftCol = range.left;
        const bottomRow = range.bottom;
        const rightCol = range.right;

        const targetBox = ExcelExporter.getRangePixelDimensions(ws, topRow, leftCol, bottomRow, rightCol);
        let naturalDim = await ExcelExporter.getImageDimensions(photoBase64);
        let cleanBase64 = photoBase64.replace(/^data:image\/\w+;base64,/, '');

        let renderWidth = targetBox.width;
        let renderHeight = targetBox.height;
        let offsetX_px = 0;
        let offsetY_px = 0;

        if (photoFitMode === 'fit') {
          const margin = 3;
          const usableWidth = Math.max(10, targetBox.width - (margin * 2));
          const usableHeight = Math.max(10, targetBox.height - (margin * 2));
          const scale = Math.min(usableWidth / naturalDim.width, usableHeight / naturalDim.height);

          renderWidth = Math.round(naturalDim.width * scale);
          renderHeight = Math.round(naturalDim.height * scale);
          offsetX_px = Math.round((targetBox.width - renderWidth) / 2);
          offsetY_px = Math.round((targetBox.height - renderHeight) / 2);
        } else if (photoFitMode === 'fill') {
          const targetRatio = targetBox.width / targetBox.height;
          const cropped = await ExcelExporter.cropImageToAspectRatio(photoBase64, targetRatio);
          cleanBase64 = cropped.cleanBase64;
          renderWidth = targetBox.width;
          renderHeight = targetBox.height;
        }

        const imageId = workbook.addImage({ base64: cleanBase64, extension: 'jpeg' });
        const decimalColOffset = Math.max(0, offsetX_px / targetBox.firstColWidth);
        const decimalRowOffset = Math.max(0, offsetY_px / targetBox.firstRowHeight);

        ws.addImage(imageId, {
          tl: {
            col: (leftCol - 1) + decimalColOffset,
            row: (topRow - 1) + decimalRowOffset
          },
          ext: {
            width: renderWidth,
            height: renderHeight
          },
          editAs: 'oneCell'
        });
      } catch (e) {
        console.warn('Erreur insertion capture Monitoring:', e);
      }
    }
  }

  async embedSignatures(workbook, ws, sigBlock, signatures) {
    if (!sigBlock) return;

    const embedSig = async (sigBase64, cellTarget) => {
      if (!sigBase64 || !cellTarget) return;
      try {
        const cleanBase64 = sigBase64.replace(/^data:image\/\w+;base64,/, '');
        const imgId = workbook.addImage({ base64: cleanBase64, extension: 'png' });
        const targetBox = ExcelExporter.getRangePixelDimensions(ws, cellTarget.row, cellTarget.col, cellTarget.row + 1, cellTarget.col + 1);
        const naturalDim = await ExcelExporter.getImageDimensions(sigBase64);

        const scale = Math.min((targetBox.width - 6) / naturalDim.width, (targetBox.height - 6) / naturalDim.height);
        const renderW = Math.round(naturalDim.width * scale);
        const renderH = Math.round(naturalDim.height * scale);
        const offsetX = Math.round((targetBox.width - renderW) / 2);
        const offsetY = Math.round((targetBox.height - renderH) / 2);

        const colOffset = offsetX / targetBox.firstColWidth;
        const rowOffset = offsetY / targetBox.firstRowHeight;

        ws.addImage(imgId, {
          tl: { col: (cellTarget.col - 1) + colOffset, row: (cellTarget.row - 1) + rowOffset },
          ext: { width: renderW, height: renderH },
          editAs: 'oneCell'
        });
      } catch (e) {}
    };

    if (signatures.foeSig && sigBlock.foeSigCell) {
      await embedSig(signatures.foeSig, sigBlock.foeSigCell);
    }
    if (signatures.expertSig && sigBlock.expertSigCell) {
      await embedSig(signatures.expertSig, sigBlock.expertSigCell);
    }
    if (signatures.airtelSig && sigBlock.airtelSigCell) {
      await embedSig(signatures.airtelSig, sigBlock.airtelSigCell);
    }
  }

  async embedSingleCellImage(workbook, ws, row, col, photoBase64, photoFitMode = 'fit') {
    try {
      const range = ExcelExporter.getCellRange(ws, row, col);
      const topRow = range.top;
      const leftCol = range.left;
      const bottomRow = range.bottom;
      const rightCol = range.right;

      const targetBox = ExcelExporter.getRangePixelDimensions(ws, topRow, leftCol, bottomRow, rightCol);
      let naturalDim = await ExcelExporter.getImageDimensions(photoBase64);
      let cleanBase64 = photoBase64.replace(/^data:image\/\w+;base64,/, '');

      let renderWidth = targetBox.width;
      let renderHeight = targetBox.height;
      let offsetX_px = 0;
      let offsetY_px = 0;

      if (photoFitMode === 'fit') {
        const margin = 2;
        const usableWidth = Math.max(10, targetBox.width - (margin * 2));
        const usableHeight = Math.max(10, targetBox.height - (margin * 2));
        const scale = Math.min(usableWidth / naturalDim.width, usableHeight / naturalDim.height);

        renderWidth = Math.round(naturalDim.width * scale);
        renderHeight = Math.round(naturalDim.height * scale);
        offsetX_px = Math.round((targetBox.width - renderWidth) / 2);
        offsetY_px = Math.round((targetBox.height - renderHeight) / 2);
      }

      const imgId = workbook.addImage({ base64: cleanBase64, extension: 'jpeg' });
      const decimalColOffset = Math.max(0, offsetX_px / targetBox.firstColWidth);
      const decimalRowOffset = Math.max(0, offsetY_px / targetBox.firstRowHeight);

      ws.addImage(imgId, {
        tl: { col: (leftCol - 1) + decimalColOffset, row: (topRow - 1) + decimalRowOffset },
        ext: { width: renderWidth, height: renderHeight },
        editAs: 'oneCell'
      });
    } catch (e) {}
  }

  // ==========================================
  // ÉTAPE 6 : Téléchargement et proposition de partage
  // ==========================================
  downloadReport(buffer, fileName) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // En environnement Android natif : sauvegarde dans cache et ouvre le panneau de partage (WhatsApp, Email, Drive)
    if (window.AndroidBridge && typeof window.AndroidBridge.saveAndShareFile === 'function') {
      const reader = new FileReader();
      reader.onload = () => {
        window.AndroidBridge.saveAndShareFile(
          reader.result,
          fileName,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
      };
      reader.readAsDataURL(blob);
      return;
    }

    // Navigateur web : Web Share API ou téléchargement direct
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], fileName)] })) {
      const file = new File([blob], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      navigator.share({
        files: [file],
        title: 'Rapport de maintenance PM Nokia',
        text: `Rapport PM ${fileName}`
      }).catch(() => {
        this.triggerBrowserDownload(blob, fileName);
      });
      return;
    }

    this.triggerBrowserDownload(blob, fileName);
  }

  triggerBrowserDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }
}

window.excelExporter = new ExcelExporter();
