/**
 * VisitManager - Gestion du modèle de données de visite multi-link Nokia PM
 * Gère la persistance en IndexedDB (clés séparées), le calcul des shareKeys,
 * les portées par défaut (SITE / IDU / LIEN) et la composition/décomposition de formData.
 */
class VisitManager {
  constructor() {
    this.TOOL_REGEX = /tool|outil|accessor|kit|tie\s*wrap|installation material|vacuum|labeling|GPS/i;
  }

  // Normalisation du texte : minuscules, sans accents, espaces et ponctuation réduits
  normalizeText(text) {
    if (!text) return '';
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  // Construit les correspondances structure <-> shareKeys pour un classeur
  buildStructureKeyMaps(structure, scopeOverrides = {}) {
    const slotToShare = new Map(); // slotKey -> { shareKey, defaultScope, effectiveScope, sheetName }
    const shareToSlots = new Map(); // shareKey -> Array of slotKey
    const itemToShare = new Map(); // itemId -> { shareKey, defaultScope, effectiveScope, sheetName }
    const shareToItems = new Map(); // shareKey -> Array of itemId

    if (!structure || !Array.isArray(structure.sheets)) {
      return { slotToShare, shareToSlots, itemToShare, shareToItems };
    }

    structure.sheets.forEach(sheet => {
      const sheetName = sheet.name || '';
      const normSheet = this.normalizeText(sheetName);

      // 1. FEUILLES GEOTAG PHOTO REPORT
      if (sheet.type === 'GEOTAG_PHOTO_REPORT' && sheet.content && Array.isArray(sheet.content.items)) {
        const occCounts = {};
        const isIduSheet = /\(3\)\s*$/.test(sheetName.trim()) || /indoor.*\(3\)/i.test(sheetName);

        sheet.content.items.forEach(item => {
          const itemDesc = item.description || item.title || '';
          const slots = Array.isArray(item.slots) ? item.slots : [];

          slots.forEach(slot => {
            const slotIndex = slot.slotIndex !== undefined ? slot.slotIndex : 0;
            const slotInstruction = slot.instruction || slot.label || '';
            const slotKey = `${item.id}_s${slotIndex}`;

            const baseItemText = this.normalizeText(`${itemDesc}__${slotInstruction}`);
            const baseShareKey = `geotag_${normSheet}_${baseItemText || 'slot'}`;
            occCounts[baseShareKey] = (occCounts[baseShareKey] || 0) + 1;
            const occ = occCounts[baseShareKey];
            const shareKey = occ > 1 ? `${baseShareKey}_occ${occ - 1}` : baseShareKey;

            // Détermination de la portée par défaut
            let defaultScope = 'link';
            if (this.TOOL_REGEX.test(itemDesc) || this.TOOL_REGEX.test(slotInstruction)) {
              defaultScope = 'site';
            } else if (isIduSheet) {
              defaultScope = 'idu';
            }

            const effectiveScope = scopeOverrides[shareKey] || defaultScope;

            const meta = {
              slotKey,
              shareKey,
              defaultScope,
              effectiveScope,
              sheetName,
              description: itemDesc,
              instruction: slotInstruction
            };

            slotToShare.set(slotKey, meta);
            if (!shareToSlots.has(shareKey)) shareToSlots.set(shareKey, []);
            shareToSlots.get(shareKey).push(slotKey);
          });
        });
      }

      // 2. FEUILLES PHYSICAL INSPECTION
      if (sheet.type === 'PHYSICAL_INSPECTION' && sheet.content && Array.isArray(sheet.content.items)) {
        const occCounts = {};
        const isIndoorSheet = /indoor/i.test(sheetName);

        sheet.content.items.forEach(item => {
          const groupText = item.group || '';
          const itemText = item.item || item.name || '';
          const baseItemText = this.normalizeText(`${groupText}__${itemText}`);
          const baseShareKey = `inspection_${normSheet}_${baseItemText || 'item'}`;

          occCounts[baseShareKey] = (occCounts[baseShareKey] || 0) + 1;
          const occ = occCounts[baseShareKey];
          const shareKey = occ > 1 ? `${baseShareKey}_occ${occ - 1}` : baseShareKey;

          let defaultScope = isIndoorSheet ? 'idu' : 'link';
          const effectiveScope = scopeOverrides[shareKey] || defaultScope;

          const meta = {
            itemId: item.id,
            shareKey,
            defaultScope,
            effectiveScope,
            sheetName,
            group: groupText,
            item: itemText
          };

          itemToShare.set(item.id, meta);
          if (!shareToItems.has(shareKey)) shareToItems.set(shareKey, []);
          shareToItems.get(shareKey).push(item.id);
        });
      }
    });

    return { slotToShare, shareToSlots, itemToShare, shareToItems };
  }

  // Calcule l'empreinte IDU (liste ordonnée des shareKeys IDU d'une structure)
  computeIduFingerprint(structure, scopeOverrides = {}) {
    const { itemToShare, slotToShare } = this.buildStructureKeyMaps(structure, scopeOverrides);
    const iduKeys = new Set();

    itemToShare.forEach(meta => {
      if (meta.effectiveScope === 'idu') iduKeys.add(meta.shareKey);
    });
    slotToShare.forEach(meta => {
      if (meta.effectiveScope === 'idu') iduKeys.add(meta.shareKey);
    });

    return Array.from(iduKeys).sort();
  }

  // Compare deux empreintes IDU (ratio d'éléments partagés 0.0 - 1.0)
  compareFingerprints(fp1, fp2) {
    if (!Array.isArray(fp1) || !Array.isArray(fp2)) return 0;
    if (fp1.length === 0 && fp2.length === 0) return 1;
    const s1 = new Set(fp1);
    const s2 = new Set(fp2);
    let common = 0;
    s1.forEach(k => {
      if (s2.has(k)) common++;
    });
    const maxLen = Math.max(s1.size, s2.size);
    return maxLen > 0 ? (common / maxLen) : 1;
  }

  // Crée un objet visite vierge (métadonnées uniquement, sans photos)
  createVisit(name = 'Nouvelle Visite') {
    const visitId = 'visit_' + Date.now();
    return {
      id: visitId,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activeLinkId: null,
      scopeOverrides: {},
      links: [],
      idus: []
    };
  }

  // Crée un groupe IDU par défaut
  createIdu(name = 'IDU 1', fingerprint = []) {
    return {
      id: 'idu_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name,
      fingerprint: Array.isArray(fingerprint) ? fingerprint : []
    };
  }

  // Composition de formData complet à partir des 3 portées (site + IDU + link)
  composeFormData(visit, siteData, iduData, linkData, structure) {
    const siteCommon = (siteData && siteData.common) || {};
    const linkCommon = (linkData && linkData.common) || {};

    // Champs SITE prioritaires pour le site, champs LIEN pour le reste
    const common = {
      date: siteCommon.date || '',
      ttRef: siteCommon.ttRef || '',
      siteName: siteCommon.siteName || '',
      siteA: siteCommon.siteA || '',
      siteLong: siteCommon.siteLong || '',
      siteLat: siteCommon.siteLat || '',
      client: siteCommon.client || '',
      partner: siteCommon.partner || '',
      country: siteCommon.country || '',
      projectName: siteCommon.projectName || '',
      // Champs spécifiques au link
      hopName: linkCommon.hopName || '',
      siteB: linkCommon.siteB || '',
      foeName: linkCommon.foeName !== undefined ? linkCommon.foeName : (siteCommon.foeName || ''),
      foeContact: linkCommon.foeContact !== undefined ? linkCommon.foeContact : (siteCommon.foeContact || ''),
      pmDescription: linkCommon.pmDescription !== undefined ? linkCommon.pmDescription : (siteCommon.pmDescription || '')
    };

    const cover = Object.assign({
      linkStatusOption: 'fine',
      minorSnagsItemsCount: '1',
      minorSnagsPageNo: 'Page 3',
      majorAlarmsItemsCount: '1',
      majorAlarmsPageNo: 'Page 6'
    }, (linkData && linkData.cover) || {});

    const radio = (linkData && linkData.radio) || { configValues: {}, tests: {} };
    const monitoring = Object.assign({}, (linkData && linkData.monitoring) || {});
    const signatures = Object.assign({ foeSig: null, expertSig: null, airtelSig: null }, (linkData && linkData.signatures) || {});
    const freeGridEdits = Object.assign({}, (linkData && linkData.freeGridEdits) || {});

    // Résolution des inspections selon les portées
    const inspections = Object.assign({}, (linkData && linkData.inspections) || {});
    const siteGeotags = (siteData && siteData.geotags) || {};
    const iduGeotags = (iduData && iduData.geotags) || {};
    const iduInspections = (iduData && iduData.inspections) || {};
    const linkGeotags = (linkData && linkData.geotags) || {};

    const geotags = Object.assign({}, linkGeotags);

    // Mappage des correspondances shareKeys -> slotKeys / itemIds du link actif
    if (structure) {
      const maps = this.buildStructureKeyMaps(structure, (visit && visit.scopeOverrides) || {});

      // Mappage des inspections IDU
      maps.itemToShare.forEach((meta, itemId) => {
        if (meta.effectiveScope === 'idu') {
          if (iduInspections[meta.shareKey]) {
            inspections[itemId] = Object.assign({}, iduInspections[meta.shareKey]);
          }
        }
      });

      // Mappage des photos Geotag SITE
      maps.slotToShare.forEach((meta, slotKey) => {
        if (meta.effectiveScope === 'site') {
          if (siteGeotags[meta.shareKey]) {
            geotags[slotKey] = siteGeotags[meta.shareKey];
          }
        } else if (meta.effectiveScope === 'idu') {
          if (iduGeotags[meta.shareKey]) {
            geotags[slotKey] = iduGeotags[meta.shareKey];
          }
        }
      });
    }

    return {
      common,
      cover,
      radio,
      inspections,
      monitoring,
      geotags,
      signatures,
      freeGridEdits
    };
  }

  // Décomposition de formData complet selon les portées (SITE / IDU / LIEN)
  decomposeFormData(visit, formData, structure, iduId, existingSite = null, existingIdu = null, existingLink = null) {
    const fCommon = (formData && formData.common) || {};
    const scopeOverrides = (visit && visit.scopeOverrides) || {};
    const maps = structure ? this.buildStructureKeyMaps(structure, scopeOverrides) : null;

    // 1. SITE DATA
    const siteData = {
      common: {
        date: fCommon.date || '',
        ttRef: fCommon.ttRef || '',
        siteName: fCommon.siteName || '',
        siteA: fCommon.siteA || '',
        siteLong: fCommon.siteLong || '',
        siteLat: fCommon.siteLat || '',
        client: fCommon.client || '',
        partner: fCommon.partner || '',
        country: fCommon.country || '',
        projectName: fCommon.projectName || '',
        // Préremplissage par défaut
        foeName: fCommon.foeName || (existingSite?.common?.foeName || ''),
        foeContact: fCommon.foeContact || (existingSite?.common?.foeContact || ''),
        pmDescription: fCommon.pmDescription || (existingSite?.common?.pmDescription || '')
      },
      geotags: Object.assign({}, existingSite?.geotags || {})
    };

    // 2. IDU DATA
    const iduData = {
      id: iduId || 'idu_default',
      inspections: Object.assign({}, existingIdu?.inspections || {}),
      geotags: Object.assign({}, existingIdu?.geotags || {})
    };

    // 3. LINK DATA
    const linkData = {
      common: {
        hopName: fCommon.hopName || '',
        siteB: fCommon.siteB || '',
        foeName: fCommon.foeName || '',
        foeContact: fCommon.foeContact || '',
        pmDescription: fCommon.pmDescription || ''
      },
      cover: Object.assign({}, formData.cover || {}),
      radio: Object.assign({}, formData.radio || { configValues: {}, tests: {} }),
      inspections: {},
      monitoring: Object.assign({}, formData.monitoring || {}),
      geotags: {},
      signatures: Object.assign({}, formData.signatures || {}),
      freeGridEdits: Object.assign({}, formData.freeGridEdits || {})
    };

    // Répartition des inspections
    const allInspections = formData.inspections || {};
    Object.keys(allInspections).forEach(itemId => {
      const entry = allInspections[itemId];
      if (!entry) return;
      const meta = maps ? maps.itemToShare.get(itemId) : null;
      if (meta && meta.effectiveScope === 'idu') {
        iduData.inspections[meta.shareKey] = {
          status: entry.status,
          detail: entry.detail || '',
          comment: entry.comment || ''
        };
      } else {
        linkData.inspections[itemId] = {
          status: entry.status,
          detail: entry.detail || '',
          comment: entry.comment || ''
        };
      }
    });

    // Répartition des photos Geotags (chaque photo stockée dans UN SEUL enregistrement)
    const allGeotags = formData.geotags || {};
    Object.keys(allGeotags).forEach(slotKey => {
      const photoBase64 = allGeotags[slotKey];
      if (!photoBase64) return;
      const meta = maps ? maps.slotToShare.get(slotKey) : null;

      if (meta && meta.effectiveScope === 'site') {
        siteData.geotags[meta.shareKey] = photoBase64;
      } else if (meta && meta.effectiveScope === 'idu') {
        iduData.geotags[meta.shareKey] = photoBase64;
      } else {
        linkData.geotags[slotKey] = photoBase64;
      }
    });

    return { siteData, iduData, linkData };
  }

  // -------------------------------------------------------------
  // ÉTAPE 2 : CALCUL DES RÉSUMÉS LÉGERS (sans photos ni templates)
  // -------------------------------------------------------------

  // Calcul du résumé du site (léger)
  computeSiteSummary(siteData) {
    const c = (siteData && siteData.common) || {};
    const geotags = (siteData && siteData.geotags) || {};
    const toolsCount = Object.keys(geotags).filter(k => geotags[k]).length;

    const hasDate = !!(c.date && String(c.date).trim());
    const hasTt = !!(c.ttRef && String(c.ttRef).trim());
    const hasSiteA = !!((c.siteA && String(c.siteA).trim()) || (c.siteName && String(c.siteName).trim()));
    const hasGps = !!((c.siteLat && String(c.siteLat).trim()) && (c.siteLong && String(c.siteLong).trim()));
    const hasClient = !!(c.client && String(c.client).trim());
    const hasPartner = !!(c.partner && String(c.partner).trim());
    const hasCountry = !!(c.country && String(c.country).trim());

    const fieldsCount = [hasDate, hasTt, hasSiteA, hasGps, hasClient, hasPartner, hasCountry].filter(Boolean).length;
    const complet = (fieldsCount >= 4 && hasDate && hasSiteA);

    return {
      date: c.date || '',
      hasDate,
      tt: c.ttRef || '',
      hasTt,
      siteA: c.siteA || c.siteName || '',
      hasSiteA,
      hasGps,
      gpsLat: c.siteLat || '',
      gpsLong: c.siteLong || '',
      client: c.client || '',
      hasClient,
      partner: c.partner || '',
      hasPartner,
      country: c.country || '',
      hasCountry,
      photosOutilsPrises: toolsCount,
      photosOutilsTotal: 4,
      complet,
      dernierChangement: Date.now()
    };
  }

  // Calcul du résumé d'un groupe IDU (léger)
  computeIduSummary(iduData) {
    const inspections = (iduData && iduData.inspections) || {};
    const geotags = (iduData && iduData.geotags) || {};

    let faits = 0;
    let notOk = 0;
    Object.values(inspections).forEach(entry => {
      if (entry && entry.status) {
        faits++;
        if (entry.status === 'NOT OK') notOk++;
      }
    });

    const geotagsPrises = Object.keys(geotags).filter(k => geotags[k]).length;

    return {
      id: (iduData && iduData.id) || 'idu_1',
      inspectionsFaits: faits,
      inspectionsTotal: Math.max(faits, 12),
      inspectionsNotOk: notOk,
      geotagsPrises,
      geotagsTotal: Math.max(geotagsPrises, 8),
      complet: faits > 0 && notOk === 0,
      dernierChangement: Date.now()
    };
  }

  // Calcul du résumé complet d'un link (sans charger d'images ni templates ultérieurement)
computeLinkSummary(formData, structure, linkSummaryPrev) {
    linkSummaryPrev = linkSummaryPrev || {};
    if (!formData) return {};
    structure = structure || { sheets: [], summary: {} };
    // 1. Photos
    let photosPrises = 0;
    let photosTotal = 0;
    const missingPhotosList = [];

    const geotagSheets = (structure && structure.sheets || [])
      .filter(s => s.type === 'GEOTAG_PHOTO_REPORT' && !s.hidden);

    geotagSheets.forEach(sheet => {
      (sheet.content?.items || []).forEach(it => {
        (it.slots || []).forEach(slot => {
          photosTotal++;
          const slotKey = `${it.id}_s${slot.slotIndex}`;
          if (formData.geotags && formData.geotags[slotKey]) {
            photosPrises++;
          } else {
            missingPhotosList.push({
              itemNo: it.itemNo,
              instruction: slot.instruction || it.description || 'Photo requise',
              tab: 'tab-geotags'
            });
          }
        });
      });
    });

    // 2. Inspections
    let inspFaits = 0;
    let inspTotal = 0;
    let inspNotOk = 0;
    const missingInspList = [];

    const inspSheets = (structure && structure.sheets || [])
      .filter(s => s.type === 'PHYSICAL_INSPECTION' && !s.hidden);

    inspSheets.forEach(sheet => {
      (sheet.content?.items || []).forEach(it => {
        inspTotal++;
        const rec = formData.inspections && formData.inspections[it.id];
        if (rec && rec.status) {
          inspFaits++;
          if (rec.status === 'NOT OK') inspNotOk++;
        } else {
          missingInspList.push({
            itemNo: it.item || it.name,
            group: it.group || '',
            tab: 'tab-inspection'
          });
        }
      });
    });

    // 3. Radio
    const radioCfg = (formData.radio && formData.radio.configValues) || {};
    const radioTests = (formData.radio && formData.radio.tests) || {};
    const radioRenseignee = Object.keys(radioCfg).length > 0 || Object.keys(radioTests).length > 0;

    // 4. Monitoring
    const monitoringRows = formData.monitoring || {};
    const monitoringTotal = Object.keys(monitoringRows).length;
    const monitoringPris = Object.values(monitoringRows).filter(r => r && (r.rxLev || r.screenShootUrl || r.status)).length;

    // 5. Signatures
    const sigs = formData.signatures || {};
    const sigCount = (sigs.foeSig ? 1 : 0) + (sigs.expertSig ? 1 : 0) + (sigs.airtelSig ? 1 : 0);

    const isTermineManuel = !!(linkSummaryPrev.termine || formData?.termine);

    const completAutomatique = (
      photosTotal > 0 && photosPrises === photosTotal &&
      inspTotal > 0 && inspFaits === inspTotal &&
      radioRenseignee &&
      sigCount >= 1
    );

    return {
      photosPrises,
      photosTotal,
      missingPhotosCount: photosTotal - photosPrises,
      missingPhotosSample: missingPhotosList.slice(0, 5),
      inspections: {
        faits: inspFaits,
        total: inspTotal,
        notOk: inspNotOk
      },
      missingInspectionsCount: inspTotal - inspFaits,
      missingInspectionsSample: missingInspList.slice(0, 5),
      radioRenseignee,
      monitoringPris,
      monitoringTotal,
      signatures: sigCount,
      termine: isTermineManuel,
      complet: completAutomatique || isTermineManuel,
      dernierChangement: Date.now(),
      dernierExport: linkSummaryPrev.dernierExport || null
    };
  }
}

window.visitManager = new VisitManager();
