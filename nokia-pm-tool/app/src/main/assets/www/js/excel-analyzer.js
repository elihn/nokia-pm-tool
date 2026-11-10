// Dynamic Excel Template Analyzer for Nokia PM Spreadsheets
// Adheres strictly to rule: Never hardcode row or column numbers.

class ExcelTemplateAnalyzer {
  constructor() {
    this.workbook = null;
  }

  // Helper to extract clean string value from cell
    static getCellValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    if (cell.value instanceof Date) return ExcelTemplateAnalyzer.formatDate(cell.value);
    if (typeof cell.value === 'object') {
      if (cell.value.text) return String(cell.value.text).trim();
      if (cell.value.richText) {
        return cell.value.richText.map(t => t.text).join('').trim();
      }
      if (cell.value.result !== undefined) return String(cell.value.result).trim();
    }
    return String(cell.value).trim();
  }

  static formatDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  static colToNum(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  // Plages fusionnées de la feuille : [{ top, left, bottom, right }]
  static parseMerges(worksheet) {
    const rects = [];
    const merges = (worksheet.model && worksheet.model.merges) || [];
    merges.forEach(m => {
      const [a, b] = String(m).split(':');
      const pa = a.match(/^([A-Z]+)(\d+)$/i);
      const pb = (b || a).match(/^([A-Z]+)(\d+)$/i);
      if (!pa || !pb) return;
      rects.push({
        top: +pa[2], left: ExcelTemplateAnalyzer.colToNum(pa[1]),
        bottom: +pb[2], right: ExcelTemplateAnalyzer.colToNum(pb[1])
      });
    });
    return rects;
  }

  static findRect(rects, r, c) {
    for (const g of rects) {
      if (r >= g.top && r <= g.bottom && c >= g.left && c <= g.right) return g;
    }
    return { top: r, left: c, bottom: r, right: c };
  }

  // Analyzes an ExcelJS workbook and produces a structured JSON schema
  analyzeWorkbook(workbook) {
    this.workbook = workbook;
    const structure = {
      analyzedAt: new Date().toISOString(),
      sheets: [],
      summary: {
        totalSheets: 0,
        recognizedSheets: 0,
        ignoredSheets: 0,
        sheetTypes: {},
        totalInspectionItems: 0,
        totalPhotoSlots: 0,
        totalMonitoringSlots: 0,
        warnings: []
      },
      commonHeaderModel: {
        siteNameCells: [],
        hopNameCells: [],
        clientCells: [],
        partnerCells: [],
        countryCells: [],
        projectCells: [],
        dateCells: [],
        pageCells: []
      },
      signatureModel: {
        foeNameCells: [],
        foeContactCells: [],
        dateCells: [],
        foeSigCells: [],
        expertSigCells: [],
        airtelSigCells: []
      }
    };

    let globalGeotagItemCounter = 0;

    workbook.eachSheet((worksheet, sheetId) => {
      const sheetName = worksheet.name.trim();

      // Check if sheet is parasite (empty or Recovered_Sheet)
      if (this.isParasiteSheet(worksheet, sheetName)) {
        structure.summary.ignoredSheets++;
        structure.summary.warnings.push(`Ignored parasite or empty sheet: "${sheetName}"`);
        return;
      }

      structure.summary.totalSheets++;
      const sheetType = this.detectSheetType(worksheet, sheetName);
      structure.summary.sheetTypes[sheetType] = (structure.summary.sheetTypes[sheetType] || 0) + 1;

      const commonHeader = this.detectCommonHeader(worksheet);
      const signatureBlock = this.detectSignatureBlock(worksheet);

      // Register cells into commonHeaderModel
      if (commonHeader.siteNameCell) {
        structure.commonHeaderModel.siteNameCells.push({ sheet: sheetName, ...commonHeader.siteNameCell });
      }
      if (commonHeader.hopNameCell) {
        structure.commonHeaderModel.hopNameCells.push({ sheet: sheetName, ...commonHeader.hopNameCell });
      }
      if (commonHeader.clientCell) {
        structure.commonHeaderModel.clientCells.push({ sheet: sheetName, ...commonHeader.clientCell });
      }
      if (commonHeader.partnerCell) {
        structure.commonHeaderModel.partnerCells.push({ sheet: sheetName, ...commonHeader.partnerCell });
      }
      if (commonHeader.countryCell) {
        structure.commonHeaderModel.countryCells.push({ sheet: sheetName, ...commonHeader.countryCell });
      }
      if (commonHeader.projectCell) {
        structure.commonHeaderModel.projectCells.push({ sheet: sheetName, ...commonHeader.projectCell });
      }
      if (commonHeader.dateCell) {
        structure.commonHeaderModel.dateCells.push({ sheet: sheetName, ...commonHeader.dateCell });
      }
      if (commonHeader.pageCell) {
        structure.commonHeaderModel.pageCells.push({ sheet: sheetName, ...commonHeader.pageCell });
      }

      if (signatureBlock.foeNameCell) {
        structure.signatureModel.foeNameCells.push({ sheet: sheetName, ...signatureBlock.foeNameCell });
      }
      if (signatureBlock.foeContactCell) {
        structure.signatureModel.foeContactCells.push({ sheet: sheetName, ...signatureBlock.foeContactCell });
      }
      if (signatureBlock.dateCell) {
        structure.signatureModel.dateCells.push({ sheet: sheetName, ...signatureBlock.dateCell });
      }
      if (signatureBlock.foeSigCell) {
        structure.signatureModel.foeSigCells.push({ sheet: sheetName, ...signatureBlock.foeSigCell });
      }
      if (signatureBlock.expertSigCell) {
        structure.signatureModel.expertSigCells.push({ sheet: sheetName, ...signatureBlock.expertSigCell });
      }
      if (signatureBlock.airtelSigCell) {
        structure.signatureModel.airtelSigCells.push({ sheet: sheetName, ...signatureBlock.airtelSigCell });
      }

      // Capture complete cell grid for Mode Libre (interactive sheet grid)
      const rawGrid = this.extractSheetGrid(worksheet);

      const sheetData = {
        id: sheetId,
        name: sheetName,
        type: sheetType,
        hidden: false,
        commonHeader,
        signatureBlock,
        rawGrid,
        content: null
      };

      switch (sheetType) {
        case 'COVER':
          sheetData.content = this.analyzeCoverSheet(worksheet);
          structure.summary.recognizedSheets++;
          break;

        case 'RADIO_CONFIG':
          sheetData.content = this.analyzeRadioConfigSheet(worksheet);
          structure.summary.recognizedSheets++;
          break;

        case 'PHYSICAL_INSPECTION':
          sheetData.content = this.analyzePhysicalInspectionSheet(worksheet);
          structure.summary.totalInspectionItems += sheetData.content.items.length;
          structure.summary.recognizedSheets++;
          break;

        case 'MONITORING':
          sheetData.content = this.analyzeMonitoringSheet(worksheet);
          structure.summary.totalMonitoringSlots += sheetData.content.items.length;
          structure.summary.recognizedSheets++;
          break;

        case 'GEOTAG_PHOTO_REPORT':
          sheetData.content = this.analyzeGeotagSheet(worksheet, globalGeotagItemCounter);
          globalGeotagItemCounter += sheetData.content.items.length;
          structure.summary.totalPhotoSlots += sheetData.content.photoSlotsCount;
          structure.summary.recognizedSheets++;
          break;

        default:
          sheetData.content = this.analyzeFreeSheet(worksheet);
          structure.summary.warnings.push(`Sheet "${sheetName}" identified as custom / free mode.`);
          break;
      }

      structure.sheets.push(sheetData);
    });

    this.recalculateItemNumbers(structure);
    return structure;
  }

  // Extract sheet grid for Mode Libre
  extractSheetGrid(worksheet) {
    const grid = [];
    const maxR = Math.min(100, worksheet.rowCount);
    for (let r = 1; r <= maxR; r++) {
      const row = worksheet.getRow(r);
      const rowData = {
        row: r,
        cells: []
      };
      const maxC = Math.min(20, Math.max(10, row.cellCount));
      for (let c = 1; c <= maxC; c++) {
        const cell = row.getCell(c);
        rowData.cells.push({
          col: c,
          address: cell.address,
          value: ExcelTemplateAnalyzer.getCellValue(cell),
          isMerged: cell.isMerged || false
        });
      }
      grid.push(rowData);
    }
    return grid;
  }

  isParasiteSheet(worksheet, sheetName) {
    if (/^recovered_|^sheet\d+$/i.test(sheetName) && worksheet.actualRowCount <= 1) {
      return true;
    }
    if (worksheet.actualRowCount === 0) return true;

    // Check if sheet contains any meaningful text
    let hasContent = false;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const val = ExcelTemplateAnalyzer.getCellValue(cell);
        if (val.length > 0) hasContent = true;
      });
    });
    return !hasContent;
  }

  detectSheetType(worksheet, sheetName) {
    const lowerName = sheetName.toLowerCase();

    if (lowerName.includes('cover') || lowerName.includes('pm data sheet') || lowerName.includes('page de garde')) {
      return 'COVER';
    }
    if (lowerName.includes('radio') || lowerName.includes('performance') || lowerName.includes('test')) {
      return 'RADIO_CONFIG';
    }
    if (lowerName.includes('physical inspection') || lowerName.includes('physical installation')) {
      return 'PHYSICAL_INSPECTION';
    }
    if (lowerName.includes('monitoring')) {
      return 'MONITORING';
    }
    if (lowerName.includes('geotag') || lowerName.includes('photo report')) {
      return 'GEOTAG_PHOTO_REPORT';
    }

    // Inspect content heuristics if sheet name is ambiguous
    let contentBlob = '';
    for (let r = 1; r <= Math.min(25, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      row.eachCell({ includeEmpty: false }, (cell) => {
        contentBlob += ' ' + ExcelTemplateAnalyzer.getCellValue(cell);
      });
    }

    if (/TXN PREVENTIVE MAINTENANCE|LINK MAINTAINED/i.test(contentBlob)) return 'COVER';
    if (/FREQUENCY ASSIGNMENT|Test Item|ODU Port/i.test(contentBlob)) return 'RADIO_CONFIG';
    if (/IDU assembly|Grounding|Waveguide|Antenna arrester|NOT OK/i.test(contentBlob)) return 'PHYSICAL_INSPECTION';
    if (/Screen Shoot|Screenshot/i.test(contentBlob)) return 'MONITORING';
    if (/Geotag photo/i.test(contentBlob)) return 'GEOTAG_PHOTO_REPORT';

    return 'OTHER';
  }

  // Common Header Detection (Project, Site, Hop, Client, Country, Partner, Date, Page)
  detectCommonHeader(worksheet) {
    const header = {};
    const maxRow = Math.min(10, worksheet.rowCount);

    for (let r = 1; r <= maxRow; r++) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= Math.min(20, row.cellCount); c++) {
        const cell = row.getCell(c);
        const text = ExcelTemplateAnalyzer.getCellValue(cell);
        if (!text) continue;

        // Site Name
        if (/^site\s*name\s*[:=]?/i.test(text)) {
          header.siteNameCell = this.resolveLabelTarget(worksheet, r, c, text, /^site\s*name\s*[:=]?\s*/i);
        }
        // Hop Name / Hope Name
        else if (/^(hop|hope)\s*name\s*[:=]?/i.test(text)) {
          header.hopNameCell = this.resolveLabelTarget(worksheet, r, c, text, /^(hop|hope)\s*name\s*[:=]?\s*/i);
        }
        // Client Name
        else if (/^client(\s*name)?\s*[:=]?/i.test(text)) {
          header.clientCell = this.resolveLabelTarget(worksheet, r, c, text, /^client(\s*name)?\s*[:=]?\s*/i);
        }
        // Partner Name
        else if (/^partner(\s*name)?\s*[:=]?/i.test(text)) {
          header.partnerCell = this.resolveLabelTarget(worksheet, r, c, text, /^partner(\s*name)?\s*[:=]?\s*/i);
        }
        // Country Name
        else if (/^country(\s*name)?\s*[:=]?/i.test(text)) {
          header.countryCell = this.resolveLabelTarget(worksheet, r, c, text, /^country(\s*name)?\s*[:=]?\s*/i);
        }
        // Project Name
        else if (/^project(\s*name)?\s*[:=]?/i.test(text)) {
          header.projectCell = this.resolveLabelTarget(worksheet, r, c, text, /^project(\s*name)?\s*[:=]?\s*/i);
        }
        // Date
        else if (/^date\s*[:=]?/i.test(text) && r <= 4) {
          header.dateCell = this.resolveLabelTarget(worksheet, r, c, text, /^date\s*[:=]?\s*/i);
        }
        // Page text e.g. "Page 1/13"
        else if (/page\s*\d+\s*\/\s*\d+/i.test(text)) {
          header.pageCell = {
            row: r,
            col: c,
            initialValue: text
          };
        }
      }
    }
    return header;
  }

  // Signature Block Detection at bottom of sheet with exact 3 representative columns
  detectSignatureBlock(worksheet) {
    const sig = {};
    const startRow = Math.max(1, worksheet.rowCount - 15);

    let partnerCol = 1;
    let expertCol = 4;
    let airtelCol = 7;

    for (let r = startRow; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= Math.min(15, row.cellCount); c++) {
        const cell = row.getCell(c);
        const text = ExcelTemplateAnalyzer.getCellValue(cell);
        if (!text) continue;

        if (/partner\s*rep/i.test(text)) partnerCol = c;
        if (/partner\s*expert|ms\s*rep/i.test(text)) expertCol = c;
        if (/airtel\s*app|airtel\s*rep/i.test(text)) airtelCol = c;

        // FOE info
        if (/foe\s*name\s*[:=]?/i.test(text) || (/^name\s*[:=]?/i.test(text) && !sig.foeNameCell && c <= partnerCol + 2)) {
          sig.foeNameCell = this.resolveLabelTarget(worksheet, r, c, text, /^(foe\s*)?name\s*[:=]?\s*/i);
        } else if (/contact\s*[:=]?/i.test(text) && !sig.foeContactCell && c <= partnerCol + 2) {
          sig.foeContactCell = this.resolveLabelTarget(worksheet, r, c, text, /^contact\s*[:=]?\s*/i);
        } else if (/date\s*[:=]?/i.test(text) && r > 10 && !sig.dateCell && c <= partnerCol + 2) {
          sig.dateCell = this.resolveLabelTarget(worksheet, r, c, text, /^date\s*[:=]?\s*/i);
          sig.foeDateCell = sig.dateCell;
        }

        // Tactile Signature cells for all 3 columns
        if (/^sig\.?\s*([:=]|$)/i.test(text)) {
          const target = this.resolveLabelTarget(worksheet, r, c, text, /^sig\.?\s*[:=]?\s*/i);
          if (c <= expertCol - 1) {
            sig.foeSigCell = target;
          } else if (c <= airtelCol - 1) {
            sig.expertSigCell = target;
          } else {
            sig.airtelSigCell = target;
          }
        }
      }
    }
    return sig;
  }

  // Helper: if label has value inside cell (e.g. "SITE NAME:  SITE_NAME"), returns inline mode.
    resolveLabelTarget(worksheet, rowIdx, colIdx, rawText, labelRegex) {
    const stripped = rawText.replace(labelRegex, '').trim();
    if (stripped.length > 0 && !/[:=]\s*$/.test(rawText)) {
      return {
        row: rowIdx,
        col: colIdx,
        inline: true,
        prefix: rawText.match(labelRegex)?.[0] || '',
        initialValue: stripped
      };
    }

    // Libellé seul : la valeur est dans la première cellule non vide à droite
    const maxCol = Math.min(colIdx + 8, worksheet.columnCount || 24);
    for (let c = colIdx + 1; c <= maxCol; c++) {
      const cell = worksheet.getRow(rowIdx).getCell(c);
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
      const v = ExcelTemplateAnalyzer.getCellValue(cell);
      if (v) return { row: rowIdx, col: c, inline: false, initialValue: v };
    }
    return { row: rowIdx, col: colIdx + 1, inline: false, initialValue: '' };
  }

  // Libellé dont la valeur s'écrit dans la même cellule ("Site A name: XXX"), même vide
  resolveInlineLabel(rowIdx, colIdx, rawText, labelRegex) {
    const m = rawText.match(labelRegex);
    const prefix = m ? m[0] : '';
    return {
      row: rowIdx,
      col: colIdx,
      inline: true,
      prefix,
      initialValue: rawText.slice(prefix.length).trim()
    };
  }

  // A) COVER Sheet Analyzer
    analyzeCoverSheet(worksheet) {
    const cover = {
      fields: {},
      linkStatusModel: { fineOption: null, minorOption: null, majorOption: null }
    };

    // Libellés ancrés en début de cellule ; la première occurrence (en haut) l'emporte
    const rules = [
      { key: 'siteLong',      re: /^site\s*long\b\s*[:=]?\s*/i },
      { key: 'siteLat',       re: /^site\s*lat\b\s*[:=]?\s*/i },
      { key: 'pmDescription', re: /^pm\s*description\b\s*[:=]?\s*/i },
      { key: 'note',          re: /^(?:note|tt\s*ref(?:erence)?)\s*[:=]\s*/i },
      { key: 'siteAName',     re: /^site\s*a\s*name\b\s*[:=]?\s*/i, inlineAlways: true },
      { key: 'siteBName',     re: /^site\s*b\s*name\b\s*[:=]?\s*/i, inlineAlways: true },
      { key: 'hopName',       re: /^hop(?:e)?\s*name\b\s*[:=]?\s*/i },
      { key: 'date',          re: /^date\s*[:=]\s*/i }
    ];

    worksheet.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        const text = ExcelTemplateAnalyzer.getCellValue(cell);
        if (!text) return;

        for (const rule of rules) {
          if (cover.fields[rule.key] || !rule.re.test(text)) continue;
          cover.fields[rule.key] = rule.inlineAlways
            ? this.resolveInlineLabel(rowIdx, colIdx, text, rule.re)
            : this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, rule.re);
          break;
        }

        // Link Status Option 1: Working fine
        if (/LINK MAINTAINED,\s*WORKING FINE/i.test(text)) {
          cover.linkStatusModel.fineOption = {
            labelRow: rowIdx,
            labelCol: colIdx,
            valueCol: colIdx + 6,
            row: rowIdx
          };
        }
        // Link Status Option 2: Minor snags
        else if (/LINK MAINTAINED,\s*WORKING WITH MINOR SNAGS/i.test(text)) {
          cover.linkStatusModel.minorOption = {
            row: rowIdx,
            itemsCountTarget: { row: rowIdx + 1, col: colIdx + 4 },
            pageNoTarget: { row: rowIdx + 2, col: colIdx + 4 }
          };
        }
        // Link Status Option 3: Major / Critical Alarm
        else if (/LINK ABNORMAL WITH MAJOR\/CRITICAL/i.test(text)) {
          cover.linkStatusModel.majorOption = {
            row: rowIdx,
            itemsCountTarget: { row: rowIdx + 1, col: colIdx + 4 },
            pageNoTarget: { row: rowIdx + 2, col: colIdx + 4 }
          };
        }
      });
    });

    cover.fields.pmDesc = cover.fields.pmDescription;
    cover.fields.ttRef = cover.fields.note;

    cover.linkStatusRows = {
      workingFine: cover.linkStatusModel.fineOption,
      minorSnags: cover.linkStatusModel.minorOption,
      majorAlarms: cover.linkStatusModel.majorOption
    };

    return cover;
  }

  // B) RADIO CONFIG Sheet Analyzer
  analyzeRadioConfigSheet(worksheet) {
    const radio = {
      configFields: {},
      testTable: {
        headerRow: null,
        columns: {
          noCol: 1,
          itemCol: 2,
          specCol: 3,
          equipCol: 4,
          portCols: []
        },
        tests: []
      }
    };

    let testHeaderFound = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
        const text = ExcelTemplateAnalyzer.getCellValue(cell);
        if (!text) return;

        if (/(?:^|\s)equipment\s*[:=]?/i.test(text) && !radio.configFields.equipment) {
          radio.configFields.equipment = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^equipment\s*[:=]?\s*/i);
        } else if (/(?:^|\s)link\s*config(?:uration)?\s*[:=]?/i.test(text) && !radio.configFields.linkConfig) {
          radio.configFields.linkConfig = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^link\s*configuration\s*[:=]?\s*/i);
        } else if (/(?:^|\s)tx\s*\[?mhz\]?\s*[:=]?/i.test(text) && !radio.configFields.txFreq) {
          radio.configFields.txFreq = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^tx\s*\[?mhz\]?\s*[:=]?\s*/i);
        } else if (/(?:^|\s)rx\s*\[?mhz\]?\s*[:=]?/i.test(text) && !radio.configFields.rxFreq) {
          radio.configFields.rxFreq = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^rx\s*\[?mhz\]?\s*[:=]?\s*/i);
        } else if (/(?:^|\s)channel\s*spacing\s*[:=]?/i.test(text) && !radio.configFields.channelSpacing) {
          radio.configFields.channelSpacing = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^channel\s*spacing\s*[:=]?\s*/i);
        } else if (/(?:^|\s)modulation\s*[:=]?/i.test(text) && !radio.configFields.modulation) {
          radio.configFields.modulation = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^modulation\s*[:=]?\s*/i);
        } else if (/(?:^|\s)e1\s*mapping/i.test(text) && !radio.configFields.e1Mapping) {
          radio.configFields.e1Mapping = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^e1\s*mapping(\s*\[ch\])?\s*[:=]?\s*/i);
        } else if (/(?:^|\s)stm1\s*mapping/i.test(text) && !radio.configFields.stm1Mapping) {
          radio.configFields.stm1Mapping = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^stm1\s*mapping(\s*\[ch\])?\s*[:=]?\s*/i);
        } else if (/(?:^|\s)ethernet\s*bandwidth/i.test(text) && !radio.configFields.ethernetBw) {
          radio.configFields.ethernetBw = this.resolveLabelTarget(worksheet, rowIdx, colIdx, text, /^ethernet\s*bandwidth(\s*\[mbps\])?\s*[:=]?\s*/i);
        } else if (/(?:^|\s)site\s*high\s*[:=]?/i.test(text) && !radio.configFields.siteHigh) {
          const valPart = text.replace(/^site\s*high\s*[:=]?\s*/i, '').trim();
          radio.configFields.siteHigh = {
            row: rowIdx,
            col: colIdx,
            inline: true,
            prefix: 'Site High:',
            initialValue: valPart
          };
        } else if (/(?:^|\s)site\s*low\s*[:=]?/i.test(text) && !radio.configFields.siteLow) {
          const valPart = text.replace(/^site\s*low\s*[:=]?\s*/i, '').trim();
          radio.configFields.siteLow = {
            row: rowIdx,
            col: colIdx,
            inline: true,
            prefix: 'Site Low:',
            initialValue: valPart
          };
        }

        // Detect Test Table Header
        if (!testHeaderFound && /test\s*item/i.test(text)) {
          testHeaderFound = true;
          radio.testTable.headerRow = rowIdx;
          radio.testTable.columns.itemCol = colIdx;
          radio.testTable.columns.specCol = colIdx + 1;
          radio.testTable.columns.equipCol = colIdx + 2;

          // Scan headerRow, headerRow + 1, and headerRow + 2 for port columns
          const portRegex = /odu\s*port|port\s*\d/i;
          const scanRows = [rowIdx, rowIdx + 1, rowIdx + 2];
          for (const rNum of scanRows) {
            if (rNum <= worksheet.rowCount) {
              const rObj = worksheet.getRow(rNum);
              rObj.eachCell({ includeEmpty: false }, (pCell, pColIdx) => {
                const pText = ExcelTemplateAnalyzer.getCellValue(pCell);
                if (portRegex.test(pText)) {
                  if (!radio.testTable.columns.portCols.some(x => x.col === pColIdx)) {
                    radio.testTable.columns.portCols.push({ col: pColIdx, label: pText });
                  }
                }
              });
            }
          }

          // If no port columns detected, default to 8 standard ODU ports
          if (radio.testTable.columns.portCols.length === 0) {
            for (let i = 1; i <= 8; i++) {
              radio.testTable.columns.portCols.push({ col: 4 + i, label: `ODU Port${i}` });
            }
          }
        }
      });

      // Extract Test rows
      if (testHeaderFound && rowIdx > (radio.testTable.headerRow + 1)) {
        const firstColVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(radio.testTable.columns.noCol || 1));
        const itemText = ExcelTemplateAnalyzer.getCellValue(row.getCell(radio.testTable.columns.itemCol));
        const numMatch = firstColVal.match(/^(\d+)/);

        if (numMatch || (itemText && !/test\s*item|signature|note|spec|sat/i.test(itemText) && radio.testTable.tests.length < 10)) {
          const testNo = numMatch ? parseInt(numMatch[1], 10) : (radio.testTable.tests.length + 1);
          const specText = ExcelTemplateAnalyzer.getCellValue(row.getCell(radio.testTable.columns.specCol));
          const equipText = ExcelTemplateAnalyzer.getCellValue(row.getCell(radio.testTable.columns.equipCol));

          const portResults = {};
          radio.testTable.columns.portCols.forEach(p => {
            portResults[p.label] = {
              col: p.col,
              value: ExcelTemplateAnalyzer.getCellValue(row.getCell(p.col))
            };
          });

          radio.testTable.tests.push({
            id: `test_r${rowIdx}`,
            row: rowIdx,
            no: testNo,
            item: itemText || `Test #${testNo}`,
            spec: specText,
            equip: equipText,
            ports: portResults
          });
        }
      }
    });

    // Fallback if no tests found in sheet: populate the standard 4 Nokia tests
    if (radio.testTable.tests.length === 0) {
      const defaultTests = [
        { no: 1, item: 'Visual Inspection', spec: 'Satisfactory', equip: 'Human inspection', defVal: 'OK' },
        { no: 2, item: 'GBE/FE Signal', spec: 'All the throughput transmitted are received at opposite site without error', equip: 'GBE Tester WEB LCT', defVal: 'NA' },
        { no: 3, item: 'Receive Signal Level', spec: 'Design RSL ± 3dBm', equip: 'Monitoring', defVal: '-37.9 dBm' },
        { no: 4, item: 'PM View', spec: 'Air Loss (s)', equip: 'Monitoring', defVal: 'OK' }
      ];
      defaultTests.forEach((dt, idx) => {
        const portResults = {};
        radio.testTable.columns.portCols.forEach(p => {
          portResults[p.label] = { col: p.col, value: p.label === 'ODU Port1' ? dt.defVal : '' };
        });
        radio.testTable.tests.push({
          id: `test_def_${dt.no}`,
          row: 7 + idx,
          no: dt.no,
          item: dt.item,
          spec: dt.spec,
          equip: dt.equip,
          ports: portResults
        });
      });
    }
    radio.editor = this.buildRadioEditor(worksheet);
    // Remplace l'ancienne détection approximative par celle de l'éditeur (cellules fusionnées gérées)
    const ed = radio.editor;

    const keyMap = [
      ['equipment', /equipment/i], ['linkConfig', /link\s*config/i],
      ['txFreq', /^tx\b/i], ['rxFreq', /^rx\b/i],
      ['channelSpacing', /channel\s*spacing/i], ['modulation', /modulation/i],
      ['e1Mapping', /e1\s*mapping/i], ['stm1Mapping', /stm1\s*mapping/i],
      ['ethernetBw', /ethernet\s*band/i],
      ['siteHigh', /site\s*high/i], ['siteLow', /site\s*low/i]
    ];
    if (ed.fields.length > 0) {
      const cf = {};
      ed.fields.forEach(f => {
        const hit = keyMap.find(([k, re]) => !cf[k] && re.test(f.label));
        if (hit) {
          cf[hit[0]] = { row: f.row, col: f.col, inline: f.inline, prefix: f.prefix, initialValue: f.value };
        }
      });
      radio.configFields = cf;
    }

    if (ed.tests && ed.tests.rows.length > 0) {
      radio.testTable = {
        headerRow: ed.tests.headerRow,
        columns: {
          noCol: ed.tests.noCol,
          itemCol: ed.tests.itemCol,
          specCol: ed.tests.specCol,
          equipCol: ed.tests.equipCol,
          portCols: ed.tests.ports
        },
        tests: ed.tests.rows.map(t => {
          const ports = {};
          t.cells.forEach(c => { ports[c.label] = { col: c.col, value: c.value }; });
          return {
            id: `test_r${t.row}`,
            row: t.row,
            no: parseInt(t.no, 10),
            item: t.name,
            spec: t.spec,
            equip: t.equip,
            ports
          };
        })
      };
    }
    return radio;
  }
  // Éditeur « Radio config » : champs et cases de tests modifiables, détectés dynamiquement
  buildRadioEditor(worksheet) {
    const MAXC = 24;
    const rects = ExcelTemplateAnalyzer.parseMerges(worksheet);
    const rectOf = (r, c) => ExcelTemplateAnalyzer.findRect(rects, r, c);
    const isSlave = (r, c) => { const g = rectOf(r, c); return !(g.top === r && g.left === c); };
    const text = (r, c) => ExcelTemplateAnalyzer.getCellValue(worksheet.getRow(r).getCell(c));
    const isLabel = (t) => /[:=]\s*$/.test(t);
    const isHeading = (t) => t.length > 12 && t === t.toUpperCase() && isLabel(t);
    const lastRow = Math.min(worksheet.rowCount, 120);

    // Ligne d'en-tête du tableau de tests ("Test Item")
    let tableRow = 0;
    for (let r = 1; r <= lastRow && !tableRow; r++) {
      for (let c = 1; c <= MAXC; c++) {
        if (!isSlave(r, c) && /^test\s*item/i.test(text(r, c))) { tableRow = r; break; }
      }
    }
    const zoneEnd = tableRow ? tableRow - 1 : Math.min(lastRow, 20);

    // 1) Champs de configuration (lignes 5 jusqu'au tableau)
    const fields = [];
    const claimed = new Set();
    const keyOf = (r, c) => `${r}_${c}`;

    for (let r = 5; r <= zoneEnd; r++) {
      for (let c = 1; c <= MAXC; c++) {
        if (isSlave(r, c)) continue;
        const t = text(r, c);
        if (!t || claimed.has(keyOf(r, c)) || isHeading(t)) continue;

        if (isLabel(t)) {
          // Libellé seul : trouver la case de valeur à sa droite
          const rect = rectOf(r, c);
          let target = null;
          let nextLabelCol = 0;
          for (let k = rect.right + 1; k <= MAXC; k++) {
            if (isSlave(r, k)) continue;
            const tk = text(r, k);
            if (tk && isLabel(tk)) { nextLabelCol = k; break; }
            if (tk) { target = { row: r, col: k, value: tk }; break; }
          }
          if (!target) {
            // Valeur vide : la case est juste avant le libellé suivant, sinon juste après le libellé
            let col = nextLabelCol ? nextLabelCol - 1 : rect.right + 1;
            if (col <= rect.right) col = rect.right + 1;
            const vr = rectOf(r, col);
            target = { row: vr.top, col: vr.left, value: '' };
          }
          if (claimed.has(keyOf(target.row, target.col))) continue;
          claimed.add(keyOf(target.row, target.col));
          fields.push({
            row: target.row, col: target.col,
            label: t.replace(/[:=]\s*$/, '').trim(),
            prefix: '', inline: false, value: target.value
          });
          continue;
        }

        // Libellé et valeur dans la même cellule : "E1 mapping [CH]: 0"
        const m = t.match(/^(.{2,45}?[:=])\s*(.+)$/);
        if (m) {
          claimed.add(keyOf(r, c));
          fields.push({
            row: r, col: c,
            label: m[1].replace(/[:=]\s*$/, '').trim(),
            prefix: m[1], inline: true, value: m[2].trim()
          });
        }
      }
    }

    // 2) Tableau de tests par port ODU
    const tests = {
      headerRow: tableRow || null,
      noCol: 0, itemCol: 0, specCol: 0, equipCol: 0,
      ports: [], rows: []
    };
    if (tableRow) {
      const isPort = (t) => /odu\s*port|^port\s*\d/i.test(t);
      let portRow = 0;
      for (let r = tableRow; r <= tableRow + 3 && !portRow; r++) {
        for (let c = 1; c <= MAXC; c++) {
          if (!isSlave(r, c) && isPort(text(r, c))) { portRow = r; break; }
        }
      }
      for (let c = 1; c <= MAXC; c++) {
        if (isSlave(tableRow, c)) continue;
        const t = text(tableRow, c);
        if (!tests.noCol && /^no\.?$/i.test(t)) tests.noCol = c;
        else if (!tests.itemCol && /^test\s*item/i.test(t)) tests.itemCol = c;
        else if (!tests.specCol && /^spec/i.test(t)) tests.specCol = c;
        else if (!tests.equipCol && /^test\s*equip/i.test(t)) tests.equipCol = c;
      }
      if (portRow) {
        for (let c = 1; c <= MAXC; c++) {
          if (isSlave(portRow, c)) continue;
          const t = text(portRow, c);
          if (isPort(t)) tests.ports.push({ col: c, label: t });
        }
        const endRow = Math.min(worksheet.rowCount, portRow + 80);
        for (let r = portRow + 1; r <= endRow; r++) {
          if (!tests.noCol || isSlave(r, tests.noCol)) continue;
          const no = text(r, tests.noCol);
          if (!/^\d+$/.test(no)) continue;
          tests.rows.push({
            no,
            row: r,
            name: tests.itemCol ? text(r, tests.itemCol) : '',
            spec: tests.specCol ? text(r, tests.specCol) : '',
            equip: tests.equipCol ? text(r, tests.equipCol) : '',
            cells: tests.ports.map(p => {
              const vr = rectOf(r, p.col);
              return { row: vr.top, col: vr.left, label: p.label, value: text(vr.top, vr.left) };
            })
          });
        }
      }
    }

    return { fields, tests };
  }
  // C) PHYSICAL INSPECTION Sheet Analyzer
  analyzePhysicalInspectionSheet(worksheet) {
    const inspection = {
      headerRow: null,
      columns: {
        groupCol: 1,
        itemCol: 2,
        okCol: 3,
        notOkCol: 4,
        detailCol: 5,
        commentCol: 6
      },
      items: [],
      groups: []
    };

    let inTable = false;
    let currentGroup = 'General';

    worksheet.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      const cell1Text = ExcelTemplateAnalyzer.getCellValue(row.getCell(1));
      if (/PARTNER REPRESENTATIVE|SIGNED BY/i.test(cell1Text)) {
        inTable = false;
        return;
      }

      if (!inTable) {
        let hasItem = false;
        let hasOk = false;
        row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
          const t = ExcelTemplateAnalyzer.getCellValue(cell);
          if (/^item$/i.test(t)) {
            hasItem = true;
            inspection.columns.itemCol = colIdx;
          } else if (/^ok$/i.test(t)) {
            hasOk = true;
            inspection.columns.okCol = colIdx;
          } else if (/^not\s*ok$/i.test(t)) {
            inspection.columns.notOkCol = colIdx;
          } else if (/^detail/i.test(t)) {
            inspection.columns.detailCol = colIdx;
          } else if (/^comment/i.test(t)) {
            inspection.columns.commentCol = colIdx;
          }
        });

        if (hasItem || hasOk) {
          inTable = true;
          inspection.headerRow = rowIdx;
          return;
        }
      }

      if (inTable && rowIdx > inspection.headerRow) {
        const grpVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(inspection.columns.groupCol));
        if (grpVal && grpVal.length > 1 && !/^\d+$/.test(grpVal)) {
          currentGroup = grpVal;
          if (!inspection.groups.includes(currentGroup)) {
            inspection.groups.push(currentGroup);
          }
        }

        const itemVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(inspection.columns.itemCol));
        if (itemVal && itemVal.length > 0 && !/PARTNER|SIGNED/i.test(itemVal)) {
          const okVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(inspection.columns.okCol));
          const notOkVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(inspection.columns.notOkCol));
          const detailVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(inspection.columns.detailCol));
          const commentVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(inspection.columns.commentCol));

          let status = 'OK';
          if (notOkVal && /not\s*ok/i.test(notOkVal)) status = 'NOT OK';
          else if (/na/i.test(okVal)) status = 'NA';
          else if (okVal && /ok/i.test(okVal)) status = 'OK';

          inspection.items.push({
            id: `insp_${worksheet.name}_r${rowIdx}`,
            row: rowIdx,
            group: currentGroup,
            item: itemVal,
            status,
            detail: detailVal,
            comment: commentVal,
            cols: {
              okCol: inspection.columns.okCol,
              notOkCol: inspection.columns.notOkCol,
              detailCol: inspection.columns.detailCol,
              commentCol: inspection.columns.commentCol
            }
          });
        }
      }
    });

    return inspection;
  }

  // D) MONITORING Sheet Analyzer
  analyzeMonitoringSheet(worksheet) {
    const monitoring = {
      headerRow: null,
      screenShootCol: 3,
      items: []
    };

    let inTable = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      const cell1Text = ExcelTemplateAnalyzer.getCellValue(row.getCell(1));
      if (/PARTNER REPRESENTATIVE|SIGNED BY/i.test(cell1Text)) {
        inTable = false;
        return;
      }

      if (!inTable) {
        row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
          const t = ExcelTemplateAnalyzer.getCellValue(cell);
          if (/screen\s*shoot|screenshot/i.test(t)) {
            inTable = true;
            monitoring.headerRow = rowIdx;
            monitoring.screenShootCol = colIdx;
          }
        });
      }

      if (inTable && rowIdx > monitoring.headerRow) {
        const noVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(1));
        const descVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(2));

        if (/^\d+/.test(noVal) || (descVal && descVal.length > 2)) {
          monitoring.items.push({
            id: `mon_${worksheet.name}_r${rowIdx}`,
            row: rowIdx,
            no: parseInt(noVal, 10) || (monitoring.items.length + 1),
            description: descVal,
            targetCol: monitoring.screenShootCol,
            image: null
          });
        }
      }
    });

    return monitoring;
  }

  // E) GEOTAG PHOTO REPORT Sheet Analyzer
  analyzeGeotagSheet(worksheet, startingIndex = 0) {
    const geotag = {
      headerRow: null,
      photoCols: [],
      items: [],
      photoSlotsCount: 0
    };

    let inTable = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      const cell1Text = ExcelTemplateAnalyzer.getCellValue(row.getCell(1));
      if (/PARTNER REPRESENTATIVE|SIGNED BY/i.test(cell1Text)) {
        inTable = false;
        return;
      }

      if (!inTable) {
        row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
          const t = ExcelTemplateAnalyzer.getCellValue(cell);
          if (/geotag\s*photo\s*\d*/i.test(t)) {
            inTable = true;
            geotag.headerRow = rowIdx;
            geotag.photoCols.push({ col: colIdx, label: t });
          }
        });
        if (inTable) return;
      }

      if (inTable && rowIdx > geotag.headerRow) {
        const noVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(1));
        const descVal = ExcelTemplateAnalyzer.getCellValue(row.getCell(2));

        if (/^\d+/.test(noVal) || (descVal && descVal.length > 2)) {
          const itemNo = parseInt(noVal, 10) || (startingIndex + geotag.items.length + 1);

          const slots = [];
          geotag.photoCols.forEach((pc, idx) => {
            const pCell = row.getCell(pc.col);
            const instruction = ExcelTemplateAnalyzer.getCellValue(pCell);

            if (instruction && instruction.length > 0) {
              geotag.photoSlotsCount++;
              slots.push({
                slotIndex: idx + 1,
                col: pc.col,
                row: rowIdx,
                headerLabel: pc.label,
                instruction: instruction,
                image: null
              });
            }
          });

          geotag.items.push({
            id: `geo_${worksheet.name}_item${itemNo}`,
            itemNo: itemNo,
            description: descVal,
            row: rowIdx,
            slots: slots
          });
        }
      }
    });

    return geotag;
  }

  // F) Free / Generic Sheet Analyzer
  analyzeFreeSheet(worksheet) {
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowIdx) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
        cells.push({
          col: colIdx,
          value: ExcelTemplateAnalyzer.getCellValue(cell)
        });
      });
      rows.push({ row: rowIdx, cells });
    });
    return { rows };
  }

  // Recalculate item numbering automatically across all Geotag sheets
  recalculateItemNumbers(structure) {
    let globalIndex = 1;
    structure.sheets.forEach(sheet => {
      if (sheet.type === 'GEOTAG_PHOTO_REPORT' && sheet.content.items) {
        sheet.content.items.forEach(it => {
          it.itemNo = globalIndex++;
        });
      }
    });

    // Update total photo slots count
    let totalPhotos = 0;
    structure.sheets.forEach(sheet => {
      if (sheet.type === 'GEOTAG_PHOTO_REPORT' && sheet.content.items) {
        sheet.content.items.forEach(it => {
          totalPhotos += it.slots ? it.slots.length : 0;
        });
      }
    });
    structure.summary.totalPhotoSlots = totalPhotos;

    // Recalculate Page x/y across all active sheets
    const visibleSheets = structure.sheets.filter(s => !s.hidden);
    const totalPages = visibleSheets.length;
    visibleSheets.forEach((s, idx) => {
      const pageStr = `Page ${idx + 1}/${totalPages}`;
      if (s.commonHeader?.pageCell) {
        s.commonHeader.pageCell.pageStr = pageStr;
      }
    });
  }

  // Structure Mutation: Duplicate a Sheet
  duplicateSheet(structure, sourceSheetName, newSheetName) {
    const source = structure.sheets.find(s => s.name === sourceSheetName);
    if (!source) throw new Error('Source sheet not found: ' + sourceSheetName);

    // Deep clone content
    const cloned = JSON.parse(JSON.stringify(source));
    cloned.id = structure.sheets.length + 1;
    cloned.name = newSheetName;
    cloned.isDuplicated = true;
    cloned.sourceSheetName = sourceSheetName;

    // Refresh IDs inside cloned items so they do not collide
    if (cloned.content?.items) {
      cloned.content.items.forEach(it => {
        it.id = `${cloned.type.toLowerCase()}_${newSheetName}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      });
    }

    structure.sheets.push(cloned);
    structure.summary.totalSheets++;
    this.recalculateItemNumbers(structure);
    return cloned;
  }

  // Structure Mutation: Reorder items (up/down)
  reorderItem(structure, sheetName, itemId, direction) {
    const sheet = structure.sheets.find(s => s.name === sheetName);
    if (!sheet || !sheet.content?.items) return;

    const items = sheet.content.items;
    const idx = items.findIndex(it => it.id === itemId);
    if (idx === -1) return;

    if (direction === 'up' && idx > 0) {
      const temp = items[idx - 1];
      items[idx - 1] = items[idx];
      items[idx] = temp;
    } else if (direction === 'down' && idx < items.length - 1) {
      const temp = items[idx + 1];
      items[idx + 1] = items[idx];
      items[idx] = temp;
    }

    this.recalculateItemNumbers(structure);
  }

  // Structure Mutation: Add a photo slot to an item (creating continuation if > 4)
  addPhotoSlotToItem(structure, sheetName, itemId, instruction = 'Additional photo') {
    const sheet = structure.sheets.find(s => s.name === sheetName);
    if (!sheet || !sheet.content?.items) return;

    const item = sheet.content.items.find(it => it.id === itemId);
    if (!item) return;

    if (!item.slots) item.slots = [];
    const newSlotIndex = item.slots.length + 1;

    // If more than 4 photos, creates a continuation row/slot
    const continuation = newSlotIndex > 4;
    const baseCol = sheet.content.photoCols[0]?.col || 3;
    const colOffset = ((newSlotIndex - 1) % 4);
    const targetCol = baseCol + colOffset;
    const rowOffset = Math.floor((newSlotIndex - 1) / 4);

    item.slots.push({
      slotIndex: newSlotIndex,
      col: targetCol,
      row: item.row + rowOffset,
      continuation: continuation,
      headerLabel: `Geotag photo ${newSlotIndex}`,
      instruction: instruction,
      image: null
    });

    this.recalculateItemNumbers(structure);
  }

  // Structure Mutation: Remove photo slot
  removePhotoSlotFromItem(structure, sheetName, itemId, slotIndex) {
    const sheet = structure.sheets.find(s => s.name === sheetName);
    if (!sheet || !sheet.content?.items) return;

    const item = sheet.content.items.find(it => it.id === itemId);
    if (!item || !item.slots) return;

    item.slots = item.slots.filter(s => s.slotIndex !== slotIndex);
    // Re-index remaining slots
    item.slots.forEach((s, i) => s.slotIndex = i + 1);

    this.recalculateItemNumbers(structure);
  }

  // Structure Mutation: Add Radio Port Column
  addRadioPortColumn(structure, portLabel = 'ODU Port New') {
    const sheet = structure.sheets.find(s => s.type === 'RADIO_CONFIG');
    if (!sheet || !sheet.content?.testTable) return;

    const table = sheet.content.testTable;
    const lastCol = table.columns.portCols[table.columns.portCols.length - 1]?.col || 5;
    const newCol = lastCol + 1;

    table.columns.portCols.push({
      col: newCol,
      label: portLabel
    });

    table.tests.forEach(test => {
      test.ports[portLabel] = {
        col: newCol,
        value: 'OK'
      };
    });
  }

  /*/ Structure Mutation: Add Radio Test Item
  addRadioTestItem(structure, itemName = 'New Test Item', spec = 'Specification', equip = 'Measurement') {
    const sheet = structure.sheets.find(s => s.type === 'RADIO_CONFIG');
    if (!sheet || !sheet.content?.testTable) return null;

    const table = sheet.content.testTable;
    const nextNo = table.tests.length + 1;
    const ports = {};
    table.columns.portCols.forEach(p => {
      ports[p.label] = { col: p.col, value: 'OK' };
    });

    const newTest = {
      no: nextNo,
      item: itemName,
      spec: spec,
      equipment: equip,
      row: (table.tests[table.tests.length - 1]?.row || 15) + 1,
      ports: ports
    };
    table.tests.push(newTest);
    return newTest;
  }*/
}

window.excelTemplateAnalyzer = new ExcelTemplateAnalyzer();

