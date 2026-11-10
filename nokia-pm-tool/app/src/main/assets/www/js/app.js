// Main Application Controller for Nokia PM Field Tool
// Designed for smartphone use, 100% offline-ready, dynamic template analysis.
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Valeur sûre à insérer comme argument JavaScript dans un onclick="..."
function jsArg(v) {
  return escapeHtml(JSON.stringify(String(v == null ? '' : v)));
}
class NokiaPMApp {
  constructor() {
    // Point 1: Single source of truth for the template
    this.templateBuffer = null; // ArrayBuffer
    this.templateName = '';     // string
    this.currentWorkbookBuffer = null; // kept in sync with templateBuffer
    this.currentTemplateName = '';

    this.currentStructure = null;
    this.currentReportId = 'draft_' + Date.now();

    this.formData = {
      common: {
        siteName: '',
        projectName: 'MS PM',
        hopName: '',
        siteA: '',
        siteB: '',
        client: 'Airtel Madagascar',
        partner: 'H-TELI',
        country: 'Madagascar',
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-'),
        ttRef: '',
        pmDescription: 'Active PM, Transmission',
        foeName: 'ELIE',
        foeContact: '+261331077902',
        siteLong: '',
        siteLat: ''
      },
      cover: {
        linkStatusOption: 'fine',
        minorSnagsItemsCount: '1',
        minorSnagsPageNo: 'Page 3',
        majorAlarmsItemsCount: '1',
        majorAlarmsPageNo: 'Page 6'
      },
      radio: { configValues: {}, tests: {} },
      inspections: {},
      monitoring: {},
      geotags: {},
      signatures: {
        foeSig: null,
        expertSig: null,
        airtelSig: null
      },
      freeGridEdits: {}
    };

    this.activeInspectionSheet = null;
    this.activeGeotagSheet = null;
    this.activeInspectionFilter = 'ALL';

    // Wizard mode state
    this.wizardItemsList = [];
    this.currentWizardIndex = 0;

    // Free mode state
    this.currentFreeCell = null;

    // Mandatory comment state
    this.pendingNotOkTarget = null;

    this.pendingPhoto = null;
    this.currentPhotoSlotTarget = null;

    // Multi-link Visit State (Étape 1A)
    this.currentVisit = null;
    this.currentLinkId = null;
    this.currentIduId = null;
    this.currentSiteData = null;
    this.currentIduData = null;
    this.autoSaveTimer = null;
    this.lastSavedHashes = {};

    // Écran de suivi de la visite (Étape 2)
    this.trackingFilter = 'all'; // 'all' | 'incomplete' | 'complete'
    this.trackingSearchQuery = '';
  }

  // -----------------------------------------------------------------
  // Point 1: Single source of truth setters
  // -----------------------------------------------------------------
  setTemplateBuffer(buf) {
    this.templateBuffer = buf;
    this.currentWorkbookBuffer = buf;
  }

  setTemplateName(name) {
    this.templateName = name;
    this.currentTemplateName = name;
    const card = document.getElementById('loadedTemplateCard');
    const disp = document.getElementById('loadedTemplateNameDisplay');
    if (card && disp) {
      card.style.display = 'block';
      disp.textContent = name;
    }
  }

      // Vrai si la PM en cours contient un vrai travail (photos, signatures, NOT OK, éditions libres)
  hasPmData() {
    const f = this.formData || {};
    const n = (o) => (o && typeof o === 'object') ? Object.keys(o).length : 0;
    const sigs = Object.values(f.signatures || {}).filter(Boolean).length;
    const notOk = Object.values(f.inspections || {}).filter(e => e && e.status && e.status !== 'OK').length;
    return n(f.geotags) + n(f.monitoring) + n(f.freeGridEdits) + sigs + notOk > 0;
  }

  // À appeler AVANT de charger un nouveau template (import ou démo).
  // Retourne false si l'utilisateur annule.
  prepareForNewTemplate() {
    if (this.hasPmData() &&
        !confirm("Importer un nouveau template effacera les photos et les saisies de la PM en cours. Continuer ?")) {
      return false;
    }

    const old = (this.formData && this.formData.common) || {};
    const today = new Date()
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      .replace(/ /g, '-');

    this.formData = {
      common: {
        siteName: '', hopName: '', siteA: '', siteB: '', ttRef: '',
        siteLong: '', siteLat: '', date: today,
        projectName: old.projectName || '', client: old.client || '',
        partner: old.partner || '', country: old.country || '',
        pmDescription: old.pmDescription || '',
        foeName: old.foeName || '', foeContact: old.foeContact || ''
      },
      cover: {
        linkStatusOption: 'fine',
        minorSnagsItemsCount: '1',
        minorSnagsPageNo: 'Page 3',
        majorAlarmsItemsCount: '1',
        majorAlarmsPageNo: 'Page 6'
      },
      radio: { configValues: {}, tests: {} },
      inspections: {},
      monitoring: {},
      geotags: {},
      signatures: { foeSig: null, expertSig: null, airtelSig: null },
      freeGridEdits: {}
    };

    // Nouvelle PM et état de l'interface remis à zéro
    this.currentReportId = 'pm_' + Date.now();
    this.currentWizardIndex = 0;
    this.activeInspectionSheet = null;
    this.activeGeotagSheet = null;
    this.activeInspectionFilter = 'ALL';
    this.pendingPhoto = null;
    this.currentPhotoSlotTarget = null;
    this.pendingNotOkTarget = null;
    this.currentFreeCell = null;

    ['sigCanvasFoe', 'sigCanvasExpert', 'sigCanvasAirtel'].forEach(id => this.clearCanvas(id));

    this.currentVisit = null;
    this.currentLinkId = null;
    this.currentIduId = null;
    this.currentSiteData = null;
    this.currentIduData = null;
    this.lastSavedHashes = {};

    const freeSel = document.getElementById('freeModeSheetSelect');
    if (freeSel) freeSel.innerHTML = '';      // la liste des feuilles de l'onglet Grille sera reconstruite
    const lbl = document.getElementById('currentSiteLabel');
    if (lbl) lbl.textContent = 'Select or Import Site Template';

    return true;
  }
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64.replace(/\s/g, ''));
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async init() {
    this.injectRadioTab();
    this.setupNavigation();
    this.setupEvents();
    this.bindInputs();
    this.setupSignaturePads();

    // Check for active visit in IndexedDB
    try {
      let restored = false;
      const activeVisitId = await window.pmDB.getState('app_active_visit');
      if (activeVisitId) {
        const visit = await window.pmDB.getState(`visit_${activeVisitId}`);
        if (visit && Array.isArray(visit.links) && visit.links.length > 0) {
          this.currentVisit = visit;
          const targetLinkId = visit.activeLinkId || visit.links[0].id;
          await this.openLink(targetLinkId);
          restored = true;
          this.showSavedIndicator('Visite restaurée');
        }
      }

      if (!restored) {
        // Fallback: Check for legacy active_report in IndexedDB
        const savedReport = await window.pmDB.getState('active_report');
        if (savedReport && savedReport.structure && savedReport.buffer) {
          await this.migrateLegacyDraftToVisit(savedReport);
          restored = true;
          this.showSavedIndicator('Draft migré en visite');
        } else {
          this.showEmptyState();
        }
      }
    } catch (err) {
      console.warn('Initialization fallback:', err);
      this.showEmptyState();
    }

    this.refreshReadiness();
    this.loadSavedReportsList();
  }
    // Premier lancement : pas de modèle de démonstration, l'utilisateur importe son template
  showEmptyState() {
    const lbl = document.getElementById('currentSiteLabel');
    if (lbl) lbl.textContent = 'Importez le template du site';
    this.switchTab('tab-template');
  }

  // Migration transparente d'un ancien rapport à plat vers le modèle de visite
  async migrateLegacyDraftToVisit(savedReport) {
    const siteName = savedReport.formData?.common?.siteName || 'Site PM';
    const visit = window.visitManager.createVisit(siteName);
    const idu = window.visitManager.createIdu('IDU 1');
    visit.idus.push(idu);

    const linkId = 'link_' + Date.now();
    const hopName = savedReport.formData?.common?.hopName || savedReport.templateName || 'Hop 1';
    visit.links.push({
      id: linkId,
      name: hopName,
      iduId: idu.id,
      templateName: savedReport.templateName || 'Saved_Site_Template.xlsx'
    });
    visit.activeLinkId = linkId;
    this.currentVisit = visit;

    const { siteData, iduData, linkData } = window.visitManager.decomposeFormData(
      visit,
      savedReport.formData,
      savedReport.structure,
      idu.id
    );

    await window.pmDB.saveState(`visit_${visit.id}_site`, siteData);
    await window.pmDB.saveState(`visit_${visit.id}_idu_${idu.id}`, iduData);

    const fullLinkData = Object.assign({}, linkData, {
      templateBuffer: savedReport.buffer,
      templateName: savedReport.templateName || 'Saved_Site_Template.xlsx',
      structure: savedReport.structure
    });
    await window.pmDB.saveState(`visit_${visit.id}_link_${linkId}`, fullLinkData);
    await window.pmDB.saveState(`visit_${visit.id}`, visit);
    await window.pmDB.saveState('app_active_visit', visit.id);

    await this.openLink(linkId);
  }

  // Ouverture d'un link : charge site + IDU + link, recompose this.formData et met à jour l'interface
  async openLink(linkId) {
    if (!this.currentVisit || !Array.isArray(this.currentVisit.links)) {
      throw new Error("Aucune visite active pour ouvrir un link");
    }
    const linkMeta = this.currentVisit.links.find(l => l.id === linkId);
    if (!linkMeta) {
      throw new Error(` Link introuvable dans la visite active : ${linkId}`);
    }

    // Sauvegarder les données du link actuel avant de basculer
    if (this.currentLinkId && this.currentLinkId !== linkId) {
      await this.flushAutoSave();
    }

    const visitId = this.currentVisit.id;

    // 1. Portée SITE
    this.currentSiteData = (await window.pmDB.getState(`visit_${visitId}_site`)) || {
      common: {},
      geotags: {}
    };

    // 2. Portée IDU
    const iduId = linkMeta.iduId || (this.currentVisit.idus[0] && this.currentVisit.idus[0].id) || 'idu_1';
    this.currentIduData = (await window.pmDB.getState(`visit_${visitId}_idu_${iduId}`)) || {
      id: iduId,
      inspections: {},
      geotags: {}
    };

    // 3. Portée LIEN
    const linkData = await window.pmDB.getState(`visit_${visitId}_link_${linkId}`);
    if (!linkData || !linkData.templateBuffer || !linkData.structure) {
      throw new Error(`Données de classeur manquantes pour le link : ${linkMeta.name}`);
    }

    this.currentLinkId = linkId;
    this.currentIduId = iduId;
    this.currentVisit.activeLinkId = linkId;

    // Définir la structure et le buffer actif en mémoire (un seul link à la fois !)
    this.setTemplateBuffer(linkData.templateBuffer);
    this.setTemplateName(linkData.templateName || linkMeta.templateName || linkMeta.name);
    this.currentStructure = linkData.structure;

    // Composer this.formData complet (site + IDU + link)
    this.formData = window.visitManager.composeFormData(
      this.currentVisit,
      this.currentSiteData,
      this.currentIduData,
      linkData,
      this.currentStructure
    );
    // Liens importés avant cette correction : préremplir la config radio depuis le template
    const rcv = (this.formData.radio && this.formData.radio.configValues) || {};
    if (Object.keys(rcv).length === 0) {
      this.formData.radio = this.formData.radio || { configValues: {}, tests: {} };
      this.formData.radio.configValues = this.extractRadioConfigValues(this.currentStructure);
    }
    // Initialiser les hashes pour dirty-checking lors d'autoSave
    this.lastSavedHashes = {
      site: JSON.stringify(this.currentSiteData),
      idu: JSON.stringify(this.currentIduData)
    };

    // Appliquer à l'interface
    this.applyFormDataToInputs();
    this.renderAllViews();

    // Persister la visite active
    await window.pmDB.saveState(`visit_${visitId}`, this.currentVisit);
    await window.pmDB.saveState('app_active_visit', visitId);

    // Mettre à jour l'en-tête du site
    const lbl = document.getElementById('currentSiteLabel');
    if (lbl) {
      const siteTxt = this.formData.common.siteName || this.currentVisit.name || 'Site PM';
      const hopTxt = this.formData.common.hopName || linkMeta.name || 'Hop';
      lbl.textContent = `${siteTxt} — ${hopTxt}`;
    }

    this.refreshReadiness();
    this.renderVisitTab();
    this.updateVisitBanner();
  }

  // -------------------------------------------------------------
  // Extraction robuste des valeurs d'un classeur Excel
  // -------------------------------------------------------------
  extractValuesFromStructure(structure) {
    const res = {
      siteLong: '',
      siteLat: '',
      siteA: '',
      siteB: '',
      ttRef: '',
      pmDescription: '',
      hopName: '',
      siteName: '',
      client: '',
      partner: '',
      country: '',
      projectName: '',
      foeName: '',
      foeContact: ''
    };

    const take = (key, v) => {
      if (v === undefined || v === null) return;
      const s = String(v).trim();
      if (!s || /[:=]\s*$/.test(s)) return;
      res[key] = s;
    };

    if (structure && Array.isArray(structure.sheets)) {
      for (const sheet of structure.sheets) {
        if (sheet.type === 'COVER' && sheet.content && sheet.content.fields) {
          const f = sheet.content.fields;
          take('siteLong', f.siteLong?.initialValue);
          take('siteLat', f.siteLat?.initialValue);
          take('siteA', f.siteAName?.initialValue);
          take('siteB', f.siteBName?.initialValue);
          take('ttRef', f.note?.initialValue);
          take('pmDescription', f.pmDescription?.initialValue);
          take('hopName', f.hopName?.initialValue);
        }
        if (sheet.commonHeader) {
          const ch = sheet.commonHeader;
          take('siteName', ch.siteNameCell?.initialValue);
          take('hopName', ch.hopNameCell?.initialValue);
          take('client', ch.clientCell?.initialValue);
          take('partner', ch.partnerCell?.initialValue);
          take('country', ch.countryCell?.initialValue);
          take('projectName', ch.projectCell?.initialValue);
        }
        if (sheet.signatureBlock) {
          take('foeName', sheet.signatureBlock.foeNameCell?.initialValue);
          take('foeContact', sheet.signatureBlock.foeContactCell?.initialValue);
        }
      }
    }

    if (res.hopName && (!res.siteA || !res.siteB)) {
      const parts = res.hopName.split(/\s+to\s+/i);
      if (parts.length === 2) {
        if (!res.siteA) res.siteA = parts[0].trim();
        if (!res.siteB) res.siteB = parts[1].trim();
      }
    }

    return res;
  }

  // -------------------------------------------------------------
  // Gestionnaire d'import multiple (Point 2)
  // -------------------------------------------------------------
  async handleTemplatesImport(files, isAddingLinks = false) {
    const fileList = Array.from(files || []);
    let validFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.xlsx'));

    if (validFiles.length === 0) {
      alert("Aucun fichier valide : les templates doivent être des classeurs Excel (.xlsx).");
      return;
    }

    if (validFiles.length < fileList.length) {
      alert(`${fileList.length - validFiles.length} fichier(s) ignoré(s) car le format n'est pas .xlsx.`);
    }
    // Empêcher les doublons : même nom de fichier déjà dans la visite, ou répété dans la sélection
    const knownNames = new Set(
      (isAddingLinks && this.currentVisit && Array.isArray(this.currentVisit.links)
        ? this.currentVisit.links : [])
        .map(l => String(l.templateName || '').trim().toLowerCase())
    );
    const keptFiles = [];
    const duplicateNames = [];
    validFiles.forEach(f => {
      const key = f.name.trim().toLowerCase();
      if (knownNames.has(key)) { duplicateNames.push(f.name); return; }
      knownNames.add(key);
      keptFiles.push(f);
    });
    if (duplicateNames.length > 0) {
      alert(`Fichier(s) déjà importé(s), ignoré(s) :\n• ${duplicateNames.join('\n• ')}`);
    }
    if (keptFiles.length === 0) return;
    validFiles = keptFiles;
    // 1. Confirmation si nécessaire (appelé UNE SEULE FOIS)
    if (!isAddingLinks) {
      if (!this.prepareForNewTemplate()) return;
    }

    // 2. Initialiser la visite si nouvelle ou si inexistante
    if (!this.currentVisit || !isAddingLinks) {
      const visit = window.visitManager.createVisit('Site PM');
      const defaultIdu = window.visitManager.createIdu('IDU 1');
      visit.idus.push(defaultIdu);
      this.currentVisit = visit;
      this.currentSiteData = {
        common: Object.assign({}, this.formData.common),
        geotags: {}
      };
    }

    // IDU par défaut = celui du dernier link existant (ou premier IDU)
    let lastIduId = this.currentVisit.links.length > 0
      ? this.currentVisit.links[this.currentVisit.links.length - 1].iduId
      : (this.currentVisit.idus[0]?.id || 'idu_1');

    let firstImportedLinkId = null;
    let successCount = 0;

    // 3. Boucle sur chaque fichier
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const progressLabel = `Import ${i + 1}/${validFiles.length}...`;
      this.showSavedIndicator(progressLabel);
      this.showToast(`${progressLabel} ${file.name}`);

      try {
        const buf = await file.arrayBuffer();
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(buf);

        const structure = window.excelTemplateAnalyzer.analyzeWorkbook(wb);
        const extracted = this.extractValuesFromStructure(structure);
        // Même hop déjà présent : probablement le même link importé sous un autre nom de fichier
        const hopKey = (extracted.hopName || '').trim().toLowerCase();
        if (hopKey && this.currentVisit.links.some(l => (l.name || '').trim().toLowerCase() === hopKey)) {
          if (!confirm(`Un link "${extracted.hopName}" existe déjà dans cette visite.\n\nImporter "${file.name}" quand même ?`)) continue;
        }

        // Valeurs communes du site : prises du premier template SEULEMENT si elles sont vides
        const isFirstSiteTemplate = (!isAddingLinks && i === 0) || !this.currentSiteData.common.siteName;
        if (isFirstSiteTemplate) {
          const siteKeys = ['date', 'ttRef', 'siteName', 'siteA', 'siteLong', 'siteLat', 'client', 'partner', 'country', 'projectName'];
          siteKeys.forEach(k => {
            if (!this.currentSiteData.common[k] && extracted[k]) {
              this.currentSiteData.common[k] = extracted[k];
            }
          });
          if (extracted.siteName) {
            this.currentVisit.name = extracted.siteName;
          }
          if (extracted.foeName && !this.currentSiteData.common.foeName) {
            this.currentSiteData.common.foeName = extracted.foeName;
          }
          if (extracted.foeContact && !this.currentSiteData.common.foeContact) {
            this.currentSiteData.common.foeContact = extracted.foeContact;
          }
          if (extracted.pmDescription && !this.currentSiteData.common.pmDescription) {
            this.currentSiteData.common.pmDescription = extracted.pmDescription;
          }
        }

        // Nom du link = hopName du template, sinon nom du fichier
        const cleanFileName = file.name.replace(/\.xlsx$/i, '');
        const linkName = extracted.hopName || cleanFileName;
        const linkId = 'link_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4);
        if (!firstImportedLinkId) firstImportedLinkId = linkId;

        // IDU par défaut = celui du link précédent (premier link : IDU 1)
        const targetIduId = lastIduId;
        lastIduId = targetIduId;

        // Comparer l'empreinte IDU
        const targetIdu = this.currentVisit.idus.find(idu => idu.id === targetIduId);
        const linkFingerprint = window.visitManager.computeIduFingerprint(structure, this.currentVisit.scopeOverrides);
        if (targetIdu) {
          if (!targetIdu.fingerprint || targetIdu.fingerprint.length === 0) {
            targetIdu.fingerprint = linkFingerprint;
          } else {
            const ratio = window.visitManager.compareFingerprints(targetIdu.fingerprint, linkFingerprint);
            if (ratio < 0.8) {
              const warningMsg = `Attention pour "${linkName}" : structure différente (${Math.round(ratio * 100)}% d'éléments communs avec ${targetIdu.name}), est-ce le même IDU ?`;
              console.warn(warningMsg);
              alert(warningMsg);
            }
          }
        }

        // Données propres au link
        const linkCommon = {
          hopName: extracted.hopName || cleanFileName,
          siteB: extracted.siteB || '',
          foeName: extracted.foeName || this.currentSiteData.common.foeName || '',
          foeContact: extracted.foeContact || this.currentSiteData.common.foeContact || '',
          pmDescription: extracted.pmDescription || this.currentSiteData.common.pmDescription || ''
        };

        const fullLinkData = {
          id: linkId,
          templateBuffer: buf,
          templateName: file.name,
          structure,
          common: linkCommon,
          cover: {
            linkStatusOption: 'fine',
            minorSnagsItemsCount: '1',
            minorSnagsPageNo: 'Page 3',
            majorAlarmsItemsCount: '1',
            majorAlarmsPageNo: 'Page 6'
          },
          radio: { configValues: this.extractRadioConfigValues(structure), tests: {} },
          inspections: {},
          monitoring: {},
          geotags: {},
          signatures: { foeSig: null, expertSig: null, airtelSig: null },
          freeGridEdits: {}
        };

        // Sauvegarder dans IndexedDB
        await window.pmDB.saveState(`visit_${this.currentVisit.id}_link_${linkId}`, fullLinkData);

        // Initialiser le résumé du link (Point 1)
        const initialSummary = window.visitManager.computeLinkSummary(
          fullLinkData,
          structure,
          null
        );

        // Ajouter le link à la liste des link de la visite
        this.currentVisit.links.push({
          id: linkId,
          name: linkName,
          iduId: targetIduId,
          templateName: file.name,
          summary: initialSummary
        });

        successCount++;
      } catch (err) {
        console.error(`Erreur import template ${file.name}:`, err);
        alert(`Erreur lors de l'analyse du template "${file.name}" : ${err.message || err}\nCe fichier a été ignoré.`);
      }
    }

    if (successCount === 0) {
      alert("Aucun link n'a pu être importé.");
      return;
    }

    // Calculer les résumés du site et des IDUs
    this.currentVisit.siteSummary = window.visitManager.computeSiteSummary(this.currentSiteData);
    this.currentVisit.idus.forEach(idu => {
      idu.summary = window.visitManager.computeIduSummary(this.currentIduData || { id: idu.id, inspections: {}, geotags: {} });
    });

    // Persister la portée site et la visite
    await window.pmDB.saveState(`visit_${this.currentVisit.id}_site`, this.currentSiteData);
    await window.pmDB.saveState(`visit_${this.currentVisit.id}`, this.currentVisit);
    await window.pmDB.saveState('app_active_visit', this.currentVisit.id);

    // Ouvrir le premier link importé
    if (firstImportedLinkId) {
      await this.openLink(firstImportedLinkId);
    }

    this.renderVisitTab();
    this.updateVisitBanner();
    this.showToast(`${successCount} link(s) importé(s) dans la visite`);
  }

  // -------------------------------------------------------------
  // Mise à jour du bandeau " Link i/N · hop · IDU x"
  // -------------------------------------------------------------
  updateVisitBanner() {
    const banner = document.getElementById('visitTopBanner');
    const bannerText = document.getElementById('visitTopBannerText');
    const activeBanner = document.getElementById('visitActiveLinkBanner');
    const btnPrev = document.getElementById('btnBannerPrevLink');
    const btnNext = document.getElementById('btnBannerNextLink');

    if (!this.currentVisit || !Array.isArray(this.currentVisit.links) || this.currentVisit.links.length === 0) {
      if (banner) banner.style.display = 'none';
      return;
    }

    const totalLinks = this.currentVisit.links.length;
    const activeIdx = this.currentVisit.links.findIndex(l => l.id === this.currentLinkId);
    const safeIdx = activeIdx >= 0 ? activeIdx : 0;
    const linkMeta = this.currentVisit.links[safeIdx];
    const idu = this.currentVisit.idus.find(i => i.id === linkMeta?.iduId);
    const iduName = idu ? idu.name : 'IDU 1';
    const hopName = this.formData?.common?.hopName || linkMeta?.name || 'Hop';

    const text = ` Link ${safeIdx + 1}/${totalLinks} · ${hopName} · ${iduName}`;

    if (bannerText) bannerText.textContent = text;
    if (activeBanner) activeBanner.textContent = text;
    if (banner) banner.style.display = 'flex';

    if (btnPrev) btnPrev.style.display = totalLinks > 1 ? 'inline-block' : 'none';
    if (btnNext) btnNext.style.display = totalLinks > 1 ? 'inline-block' : 'none';
  }

  // -------------------------------------------------------------
  // ÉTAPE 2 : ÉCRAN DE SUIVI DE LA VISITE (par site, par IDU, par link)
  // -------------------------------------------------------------
  renderVisitTab() {
    this.updateVisitBanner();
    const visit = this.currentVisit;
    if (!visit) return;

    // Mise à jour du bouton d'export de la visite (Règle 6)
    const linksCount = (visit.links && visit.links.length) || 0;
    const btnExportVisitText = document.getElementById('btnExportVisitText');
    if (btnExportVisitText) {
      btnExportVisitText.textContent = linksCount > 1
        ? `Exporter (${linksCount})`
        : `Exporter`;
    }
    const btnExportVisit = document.getElementById('btnExportVisit');
    if (btnExportVisit) {
      btnExportVisit.style.display = linksCount > 0 ? 'inline-flex' : 'none';
    }

    this.renderTrackingSection();
  }

  // Rendu en une seule passe, ultra-fluide avec 20 link (sans charger de photos ni buffers)
  renderTrackingSection() {
    const visit = this.currentVisit;
    if (!visit || !Array.isArray(visit.links)) return;

    const totalLinks = visit.links.length;
    let completedLinksCount = 0;

    visit.links.forEach(l => {
      const s = l.summary || (visit.linkSummaries && visit.linkSummaries[l.id]) || {};
      if (s.termine || s.complet) completedLinksCount++;
    });

    const pct = totalLinks > 0 ? Math.round((completedLinksCount / totalLinks) * 100) : 0;

    // Mise à jour de la barre et des compteurs
    const pBar = document.getElementById('trackingProgressBar');
    const pPct = document.getElementById('trackingProgressPercent');
    const pCount = document.getElementById('trackingProgressCount');
    const pBadge = document.getElementById('trackingProgressBadge');

    if (pBar) pBar.style.width = `${pct}%`;
    if (pPct) pPct.textContent = `${pct}% complété`;
    if (pCount) pCount.textContent = `${completedLinksCount} link sur ${totalLinks} terminés`;
    if (pBadge) pBadge.textContent = `${completedLinksCount} / ${totalLinks} Terminés`;

    // Filtres counts
    const countAll = document.getElementById('countFilterAll');
    const countIncomp = document.getElementById('countFilterIncomplete');
    const countComp = document.getElementById('countFilterComplete');
    if (countAll) countAll.textContent = totalLinks;
    if (countIncomp) countIncomp.textContent = totalLinks - completedLinksCount;
    if (countComp) countComp.textContent = completedLinksCount;

    // 1. SECTION SITE
    const siteGrid = document.getElementById('trackingSiteGrid');
    const siteBadge = document.getElementById('trackingSiteStatusBadge');
    const siteSummary = visit.siteSummary || (this.currentSiteData ? window.visitManager.computeSiteSummary(this.currentSiteData) : {});

    if (siteBadge) {
      if (siteSummary.complet) {
        siteBadge.style.background = 'rgba(0, 230, 118, 0.2)';
        siteBadge.style.color = '#00e676';
        siteBadge.textContent = '✓ SITE PRÊT';
      } else {
        siteBadge.style.background = 'rgba(255, 179, 0, 0.2)';
        siteBadge.style.color = '#ffb300';
        siteBadge.textContent = '⚠️ SITE INCOMPLET';
      }
    }

    if (siteGrid) {
      siteGrid.innerHTML = '';
      const items = [
        { label: 'Date', ok: siteSummary.hasDate, val: siteSummary.date || 'Non renseignée', tab: 'tab-template' },
        { label: 'TT Ref', ok: siteSummary.hasTt, val: siteSummary.tt || 'Non renseigné', tab: 'tab-field' },
        { label: 'Site A', ok: siteSummary.hasSiteA, val: siteSummary.siteA || 'Non renseigné', tab: 'tab-template' },
        { label: 'GPS', ok: siteSummary.hasGps, val: siteSummary.hasGps ? `${String(siteSummary.gpsLat).slice(0, 7)}, ${String(siteSummary.gpsLong).slice(0, 7)}` : 'Non fixé', tab: 'tab-template' },
        { label: 'Client', ok: siteSummary.hasClient, val: siteSummary.client || 'Non renseigné', tab: 'tab-field' },
        { label: 'Partner', ok: siteSummary.hasPartner, val: siteSummary.partner || 'Non renseigné', tab: 'tab-field' },
        { label: 'Country', ok: siteSummary.hasCountry, val: siteSummary.country || 'Non renseigné', tab: 'tab-field' },
        { label: 'Photos Outils', ok: (siteSummary.photosOutilsPrises || 0) > 0, val: `${siteSummary.photosOutilsPrises || 0} prises`, tab: 'tab-geotags' }
      ];

      items.forEach(it => {
        const div = document.createElement('div');
        div.style.background = it.ok ? 'rgba(0, 230, 118, 0.06)' : 'rgba(255, 179, 0, 0.08)';
        div.style.border = `1px solid ${it.ok ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 179, 0, 0.25)'}`;
        div.style.borderRadius = 'var(--radius-sm)';
        div.style.padding = '6px 8px';
        div.style.cursor = 'pointer';
        div.title = `Cliquer pour modifier ${it.label}`;
        div.innerHTML = `
          <div style="color: ${it.ok ? '#00e676' : '#ffb300'}; font-weight: 700;">${it.ok ? '✓' : '⚠️'} ${escapeHtml(it.label)}</div>
          <div style="color: var(--text-muted); font-size: 10px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(it.val)}</div>
        `;
        div.addEventListener('click', () => this.switchTab(it.tab));
        siteGrid.appendChild(div);
      });
    }

    // 2. SECTION IDU
    const idusContainer = document.getElementById('trackingIdusContainer');
    if (idusContainer) {
      idusContainer.innerHTML = '';
      (visit.idus || []).forEach(idu => {
        const iduSum = (visit.iduSummaries && visit.iduSummaries[idu.id]) || {};
        const linksInIdu = visit.links.filter(l => l.iduId === idu.id).length;

        const card = document.createElement('div');
        card.style.background = 'rgba(0, 30, 70, 0.4)';
        card.style.border = '1px solid rgba(0, 102, 255, 0.25)';
        card.style.borderRadius = 'var(--radius-sm)';
        card.style.padding = '8px 12px';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.flexWrap = 'wrap';
        card.style.gap = '8px';

        card.innerHTML = `
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 13px;">${escapeHtml(idu.name)}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
              ${linksInIdu} link${linksInIdu > 1 ? 's' : ''} associé${linksInIdu > 1 ? 's' : ''} ·
              Inspections : ${iduSum.inspectionsFaits || 0} faites
              ${iduSum.inspectionsNotOk > 0 ? `<span style="color: #ff3b30; font-weight: 700;">(${iduSum.inspectionsNotOk} NOT OK)</span>` : ''} ·
              Geotag IDU : ${iduSum.geotagsPrises || 0} photos
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline btn-rename-idu" data-idu-id="${escapeHtml(idu.id)}" style="padding: 2px 8px; font-size: 11px;">Renommer</button>
            ${(visit.idus.length > 1 && linksInIdu === 0) ? `<button class="btn btn-sm btn-outline btn-delete-idu" data-idu-id="${escapeHtml(idu.id)}" style="padding: 2px 8px; font-size: 11px; color: var(--danger); border-color: rgba(255,59,48,0.4);">Suppr.</button>` : ''}
          </div>
        `;

        card.querySelector('.btn-rename-idu')?.addEventListener('click', async () => {
          const newName = prompt(`Nouveau nom pour "${idu.name}" :`, idu.name);
          if (newName && newName.trim() && newName.trim() !== idu.name) {
            await this.renameIdu(idu.id, newName.trim());
          }
        });

        card.querySelector('.btn-delete-idu')?.addEventListener('click', async () => {
          if (confirm(`Supprimer le groupe "${idu.name}" ?`)) await this.deleteIdu(idu.id);
        });

        idusContainer.appendChild(card);
      });
    }

    // 3. SECTION LIENS REGROUPÉS PAR IDU
    const linksByIduContainer = document.getElementById('trackingLinksByIduContainer');
    if (linksByIduContainer) {
      linksByIduContainer.innerHTML = '';

      const query = (this.trackingSearchQuery || '').toLowerCase();
      const filter = this.trackingFilter || 'all';

      (visit.idus || []).forEach(idu => {
        const iduLinks = visit.links.filter(l => {
          if (l.iduId !== idu.id) return false;
          const s = l.summary || (visit.linkSummaries && visit.linkSummaries[l.id]) || {};
          const isComp = !!(s.termine || s.complet);

          // Filtre complet / incomplet
          if (filter === 'incomplete' && isComp) return false;
          if (filter === 'complete' && !isComp) return false;

          // Filtre recherche textuelle
          if (query) {
            const matchName = (l.name || '').toLowerCase().includes(query);
            const matchHop = (l.hopName || '').toLowerCase().includes(query);
            const matchTpl = (l.templateName || '').toLowerCase().includes(query);
            if (!matchName && !matchHop && !matchTpl) return false;
          }
          return true;
        });

        // Un IDU vide reste visible (sans filtre ni recherche) pour pouvoir y affecter des link
        const noFilterActive = (filter === 'all' && !query);
        if (iduLinks.length === 0 && !noFilterActive) return;

        // Bloc du groupe IDU
        const iduGroupBlock = document.createElement('div');
        iduGroupBlock.className = 'card';
        iduGroupBlock.style.background = 'var(--bg-card)';
        iduGroupBlock.style.marginBottom = '10px';

        iduGroupBlock.innerHTML = `
          <div class="card-header" style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
            <div class="card-title" style="font-size: 13px; color: #70d6ff;">
              📦 Groupe ${escapeHtml(idu.name)} (${iduLinks.length} link${iduLinks.length > 1 ? 's' : ''})
            </div>
          </div>
          <div class="idu-links-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
        `;

        const listEl = iduGroupBlock.querySelector('.idu-links-list');
        if (iduLinks.length === 0) {
          listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 6px 2px;">Aucun link dans ce groupe. Utilisez le sélecteur d\'IDU d\'un link pour l\'y déplacer.</div>';
        }

        iduLinks.forEach(link => {
          const s = link.summary || (visit.linkSummaries && visit.linkSummaries[link.id]) || {};
          const isActive = (link.id === this.currentLinkId);
          const isTermine = !!s.termine;
          const isComplet = !!s.complet;

          // Pastille de couleur (Règle 2 : vide / en cours / complet)
          let dotColor = '#607d8b'; // vide (gris/bleu)
          let dotTitle = 'Non commencé';
          if (isTermine || isComplet) {
            dotColor = '#00e676'; // complet (vert)
            dotTitle = isTermine ? 'Terminé (validé)' : 'Complet';
          } else if ((s.photosPrises || 0) > 0 || (s.inspections && s.inspections.faits > 0) || s.radioRenseignee) {
            dotColor = '#ffb300'; // en cours (orange/jaune)
            dotTitle = 'En cours de saisie';
          }

          const hasNotOk = s.inspections && s.inspections.notOk > 0;
          const isModifiedAfterExport = s.dernierExport && s.dernierChangement > s.dernierExport;

          const linkCard = document.createElement('div');
          linkCard.style.padding = '10px 12px';
          linkCard.style.borderRadius = 'var(--radius-sm)';
          linkCard.style.border = isActive ? '2px solid var(--accent)' : '1px solid var(--border-color)';
          linkCard.style.background = isActive ? 'rgba(0, 229, 255, 0.08)' : 'rgba(0, 20, 40, 0.4)';

          linkCard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0;" title="${dotTitle}"></span>
                <div style="font-weight: 700; font-size: 14px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(link.name)}
                </div>
              </div>
              <div style="display: flex; gap: 4px; flex-shrink: 0; align-items: center;">
                ${isActive ? '<span class="badge badge-accent">Actif</span>' : ''}
                ${isTermine ? '<span class="badge badge-success">✓ Terminé</span>' : ''}
                ${hasNotOk ? `<span class="badge" style="background: rgba(255,59,48,0.2); color: #ff3b30; font-weight:700;">${s.inspections.notOk} NOT OK</span>` : ''}
                ${isModifiedAfterExport ? `<span class="badge" style="background: rgba(255,179,0,0.2); color: #ffb300;" title="Données modifiées après le dernier export">Modifié</span>` : ''}
              </div>
            </div>

            <!-- Compteurs d'avancement -->
            <div style="display: flex; gap: 10px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; margin-bottom: 8px;">
              <span>📷 <strong>${s.photosPrises || 0}/${s.photosTotal || 0}</strong> photos</span>
              <span>📋 <strong>${(s.inspections && s.inspections.faits) || 0}/${(s.inspections && s.inspections.total) || 0}</strong> insp.</span>
              <span>📡 Radio : <strong style="color: ${s.radioRenseignee ? '#00e676' : '#ffb300'};">${s.radioRenseignee ? 'OK' : 'Non'}</strong></span>
              <span>✍️ Signatures : <strong>${s.signatures || 0}/3</strong></span>
            </div>

            <!-- Éléments manquants cliquables (Règle 3) -->
            <div class="missing-items-box" style="margin-bottom: 8px; font-size: 11px;"></div>

            <!-- Ligne d'actions : Terminé (case à cocher manuelle) + Bouton Ouvrir -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: ${isTermine ? '#00e676' : 'var(--text-muted)'}; margin: 0;">
                <input type="checkbox" class="chk-toggle-termine" data-link-id="${escapeHtml(link.id)}" ${isTermine ? 'checked' : ''}>
                <span>${isTermine ? ' Link Terminé' : 'Marquer terminé'}</span>
              </label>

              <div style="display: flex; gap: 6px; align-items: center;">
                ${(visit.idus || []).length > 1 ? `
                  <select class="sel-link-idu" title="Groupe IDU de ce link" style="padding: 3px 4px; font-size: 11px; max-width: 110px;">
                    ${(visit.idus || []).map(i => `<option value="${escapeHtml(i.id)}" ${i.id === link.iduId ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
                  </select>` : ''}
                <button class="btn btn-sm ${isActive ? 'btn-outline' : 'btn-primary'} btn-open-link" data-link-id="${escapeHtml(link.id)}" style="padding: 3px 12px; font-size: 11px;">
                  ${isActive ? 'Éditer' : 'Ouvrir'}
                </button>
                  ${(visit.links || []).length > 1 ? `
                <button class="btn btn-sm btn-outline btn-delete-link" title="Supprimer ce link"
                  style="padding: 3px 8px; font-size: 11px; color: var(--danger); border-color: rgba(255,59,48,0.4);">🗑
                </button>` : ''}
              </div>
            </div>
          `;

          // Injection des tags cliquables d'éléments manquants
          const missingBox = linkCard.querySelector('.missing-items-box');
          if (!isTermine && !isComplet) {
            const tags = [];
            if (!s.radioRenseignee) {
              tags.push({ text: '📡 Radio à remplir', tab: 'tab-radio' });
            }
            if ((s.missingInspectionsCount || 0) > 0) {
              tags.push({ text: `📋 ${s.missingInspectionsCount} inspection(s)`, tab: 'tab-inspection' });
            }
            if ((s.missingPhotosCount || 0) > 0) {
              tags.push({ text: `📷 ${s.missingPhotosCount} photo(s)`, tab: 'tab-geotags' });
            }
            if ((s.signatures || 0) < 1) {
              tags.push({ text: '✍️ Signatures', tab: 'tab-signatures' });
            }

            if (tags.length > 0) {
              missingBox.innerHTML = '<span style="color: var(--text-muted); font-size: 10px;">Manquant : </span>';
              tags.forEach(t => {
                const badgeTag = document.createElement('span');
                badgeTag.style.display = 'inline-block';
                badgeTag.style.background = 'rgba(255, 179, 0, 0.12)';
                badgeTag.style.border = '1px solid rgba(255, 179, 0, 0.3)';
                badgeTag.style.color = '#ffb300';
                badgeTag.style.borderRadius = '3px';
                badgeTag.style.padding = '1px 5px';
                badgeTag.style.marginRight = '4px';
                badgeTag.style.marginBottom = '2px';
                badgeTag.style.cursor = 'pointer';
                badgeTag.textContent = t.text;
                badgeTag.addEventListener('click', async (e) => {
                  e.stopPropagation();
                  if (this.currentLinkId !== link.id) {
                    await this.openLink(link.id);
                  }
                  this.switchTab(t.tab);
                });
                missingBox.appendChild(badgeTag);
              });
            }
          }

          // Événement Case "Marquer terminé" (Règle 4)
          linkCard.querySelector('.chk-toggle-termine')?.addEventListener('change', async () => {
            await this.toggleLinkTermine(link.id);
          });
          // Changer le groupe IDU de ce link
          linkCard.querySelector('.sel-link-idu')?.addEventListener('change', async (e) => {
            await this.changeLinkIdu(link.id, e.target.value);
          });
                    linkCard.querySelector('.btn-delete-link')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.deleteLink(link.id);
          });
          // Événement Ouvrir  Link
          linkCard.querySelector('.btn-open-link')?.addEventListener('click', async () => {
            if (this.currentLinkId !== link.id) {
              await this.openLink(link.id);
            }
            this.switchTab('tab-field');
          });

          listEl.appendChild(linkCard);
        });

        linksByIduContainer.appendChild(iduGroupBlock);
      });

      if (linksByIduContainer.children.length === 0) {
        linksByIduContainer.innerHTML = '<div style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 20px;">Aucun link ne correspond aux filtres appliqués.</div>';
      }
    }
  }

  // -------------------------------------------------------------
  // Prochain élément manquant (Bouton "Continuer" - Règle 3)
  // -------------------------------------------------------------
  async continueNextMissingItem() {
    const visit = this.currentVisit;
    if (!visit) {
      this.switchTab('tab-template');
      return;
    }

    // 1. Priorité 1 : Données Site
    const siteSummary = visit.siteSummary || (this.currentSiteData ? window.visitManager.computeSiteSummary(this.currentSiteData) : {});
    if (!siteSummary.hasSiteA || !siteSummary.hasDate || !siteSummary.hasTt) {
      this.showToast('Complétez les informations communes du site');
      this.switchTab('tab-template');
      return;
    }
    if (!siteSummary.hasGps) {
      this.showToast('Acquittez ou renseignez les coordonnées GPS du site');
      this.switchTab('tab-template');
      document.getElementById('btnAcquireGPS')?.focus();
      return;
    }

    // 2. Priorité 2 : IDU (inspections Indoor du groupe IDU)
    const iduSum = (visit.iduSummaries && visit.iduSummaries[this.currentIduId || 'idu_1']) || {};
    if ((iduSum.inspectionsFaits || 0) === 0) {
      this.showToast('Complétez les inspections physiques Indoor du groupe IDU');
      this.switchTab('tab-inspection');
      return;
    }

    // 3. Priorité 3 :  Links (premier link incomplet)
    const links = visit.links || [];
    let targetLink = null;
    for (const l of links) {
      const s = l.summary || (visit.linkSummaries && visit.linkSummaries[l.id]) || {};
      if (!s.termine && !s.complet) {
        targetLink = l;
        break;
      }
    }

    if (!targetLink && links.length > 0) {
      this.showToast('Tous les link sont terminés ! Prêt pour l\'exportation.');
      this.switchTab('tab-visit');
      return;
    }

    if (targetLink) {
      if (this.currentLinkId !== targetLink.id) {
        await this.openLink(targetLink.id);
      }
      const s = targetLink.summary || (visit.linkSummaries && visit.linkSummaries[targetLink.id]) || {};

      if (!s.radioRenseignee) {
        this.showToast(`${targetLink.name} : complétez la Configuration Radio`);
        this.switchTab('tab-radio');
        return;
      }
      if (s.inspections && s.inspections.faits < s.inspections.total) {
        this.showToast(`${targetLink.name} : complétez les inspections physiques`);
        this.switchTab('tab-inspection');
        return;
      }
      if ((s.photosPrises || 0) < (s.photosTotal || 0)) {
        this.showToast(`${targetLink.name} : ${s.photosTotal - s.photosPrises} photo(s) restante(s)`);
        this.switchTab('tab-geotags');
        return;
      }
      if ((s.signatures || 0) < 1) {
        this.showToast(`${targetLink.name} : signature requise`);
        this.switchTab('tab-signatures');
        return;
      }
    }

    this.switchTab('tab-visit');
  }

  // -------------------------------------------------------------
  // Navigation guidée entre link (Boutons  Link précédent /  Link suivant - Règle 3)
  // -------------------------------------------------------------
  async navigateToAdjacentLink(direction = 1) {
    const visit = this.currentVisit;
    if (!visit || !Array.isArray(visit.links) || visit.links.length <= 1) return;
    const currentIndex = visit.links.findIndex(l => l.id === this.currentLinkId);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = visit.links.length - 1;
    if (nextIndex >= visit.links.length) nextIndex = 0;
    const targetLink = visit.links[nextIndex];
    if (targetLink) {
      await this.openLink(targetLink.id);
      this.showToast(`Ouverture : ${targetLink.name}`);
    }
  }

  // -------------------------------------------------------------
  // État "Terminé" manuel d'un link (Règle 4)
  // -------------------------------------------------------------
  async toggleLinkTermine(linkId) {
    const visit = this.currentVisit;
    if (!visit) return;
    const linkMeta = visit.links.find(l => l.id === linkId);
    if (!linkMeta) return;

    const summary = linkMeta.summary || (visit.linkSummaries && visit.linkSummaries[linkId]) || {};
    const currentStatus = !!summary.termine;

    if (!currentStatus) {
      // Tenter de marquer Terminé : vérifier les éléments manquants
      const missing = [];
      if ((summary.photosTotal || 0) > (summary.photosPrises || 0)) {
        missing.push(`${summary.photosTotal - summary.photosPrises} photo(s) manquante(s)`);
      }
      if (summary.inspections && summary.inspections.faits < summary.inspections.total) {
        missing.push(`${summary.inspections.total - summary.inspections.faits} inspection(s) non réalisée(s)`);
      }
      if (!summary.radioRenseignee) {
        missing.push("Configuration Radio non renseignée");
      }
      if ((summary.signatures || 0) < 1) {
        missing.push("Signatures non apposées");
      }

      if (missing.length > 0) {
        const confirmForce = confirm(
          `Attention, ce link comporte encore des éléments manquants :\n\n• ${missing.join('\n• ')}\n\nVoulez-vous quand même forcer ce link comme TERMINÉ ?`
        );
        if (!confirmForce) {
          this.renderVisitTab();
          return;
        }
      }

      summary.termine = true;
    } else {
      summary.termine = false;
    }

    summary.dernierChangement = Date.now();
    linkMeta.summary = summary;
    visit.linkSummaries = visit.linkSummaries || {};
    visit.linkSummaries[linkId] = summary;

    await window.pmDB.saveState(`visit_${visit.id}`, visit);
    const linkData = await window.pmDB.getState(`visit_${visit.id}_link_${linkId}`);
    if (linkData) {
      linkData.termine = summary.termine;
      linkData.dernierChangement = summary.dernierChangement;
      await window.pmDB.saveState(`visit_${visit.id}_link_${linkId}`, linkData);
    }

    this.renderVisitTab();
    this.showToast(summary.termine ? ` Link "${linkMeta.name}" marqué TERMINÉ` : ` Link "${linkMeta.name}" marqué EN COURS`);
  }

  // -------------------------------------------------------------
  // Dialogue de choix d'export :  Links terminés vs Tous les link (Règle 5)
  // -------------------------------------------------------------
  async showExportOptionsModal() {
    if (window.AndroidBridge && typeof window.AndroidBridge.isOperationAllowed === 'function') {
      if (!window.AndroidBridge.isOperationAllowed('export')) {
        if (window.openLicenseModal) window.openLicenseModal();
        return;
      }
    }

    const visit = this.currentVisit;
    if (!visit || !Array.isArray(visit.links) || visit.links.length === 0) {
      alert("Aucun link à exporter dans la visite.");
      return;
    }

    const total = visit.links.length;
    const completedLinks = [];
    const incompleteLinks = [];

    visit.links.forEach(l => {
      const s = l.summary || (visit.linkSummaries && visit.linkSummaries[l.id]) || {};
      if (s.termine || s.complet) {
        completedLinks.push(l);
      } else {
        incompleteLinks.push(l);
      }
    });

    // Si tous les link sont terminés, lancer directement l'exportation complète
    if (incompleteLinks.length === 0) {
      return this.exportVisit();
    }

    const modal = document.getElementById('exportOptionsModal');
    const body = document.getElementById('exportOptionsBody');
    const btnOnlyCompleted = document.getElementById('btnExportOnlyCompletedOption');
    const btnAll = document.getElementById('btnExportAllOption');
    const btnCancel = document.getElementById('btnCancelExportOptions');
    const btnClose = document.getElementById('btnCloseExportOptions');

    if (!modal || !body || !btnAll || !btnCancel || !btnClose) {
      return this.exportVisit();
    }

    const countComp = document.getElementById('countCompletedExport');
    const countAll = document.getElementById('countAllExport');
    if (countComp) countComp.textContent = completedLinks.length;
    if (countAll) countAll.textContent = total;

    if (completedLinks.length > 0 && btnOnlyCompleted) {
      btnOnlyCompleted.style.display = 'block';
    } else if (btnOnlyCompleted) {
      btnOnlyCompleted.style.display = 'none';
    }

    body.innerHTML = `
      <div style="background: rgba(0, 230, 118, 0.08); border: 1px solid rgba(0, 230, 118, 0.25); border-radius: var(--radius-sm); padding: 10px; margin-bottom: 10px;">
        <div style="font-weight: 700; color: #00e676;">✓  Links prêts / terminés (${completedLinks.length}/${total})</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          ${completedLinks.length > 0 ? completedLinks.map(l => escapeHtml(l.name)).join(', ') : 'Aucun link complet pour l\'instant.'}
        </div>
      </div>

      <div style="background: rgba(255, 179, 0, 0.08); border: 1px solid rgba(255, 179, 0, 0.25); border-radius: var(--radius-sm); padding: 10px; margin-bottom: 12px;">
        <div style="font-weight: 700; color: #ffb300;">⚠️  Links incomplets (${incompleteLinks.length}/${total})</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          ${incompleteLinks.map(l => {
            const s = l.summary || (visit.linkSummaries && visit.linkSummaries[l.id]) || {};
            const miss = [];
            if ((s.photosTotal || 0) > (s.photosPrises || 0)) miss.push(`${s.photosTotal - s.photosPrises} photos`);
            if (s.inspections && s.inspections.faits < s.inspections.total) miss.push(`${s.inspections.total - s.inspections.faits} insp.`);
            if (!s.radioRenseignee) miss.push('radio');
            if ((s.signatures || 0) < 1) miss.push('signatures');
            return `• <strong>${escapeHtml(l.name)}</strong> : ${miss.join(', ') || 'à compléter'}`;
          }).join('<br>')}
        </div>
      </div>
    `;

    const cleanup = () => {
      modal.classList.remove('active');
      btnOnlyCompleted.onclick = null;
      btnAll.onclick = null;
      btnCancel.onclick = null;
      btnClose.onclick = null;
    };

    btnOnlyCompleted.onclick = async () => {
      cleanup();
      await this.exportVisit(completedLinks.map(l => l.id));
    };

    btnAll.onclick = async () => {
      cleanup();
      await this.exportVisit();
    };

    btnCancel.onclick = cleanup;
    btnClose.onclick = cleanup;

    modal.classList.add('active');
  }

  // -------------------------------------------------------------
  // Déplacement d'un link vers un autre groupe IDU (Point 5)
  // -------------------------------------------------------------
  async changeLinkIdu(linkId, newIduId) {
    if (!this.currentVisit) return;
    const linkMeta = this.currentVisit.links.find(l => l.id === linkId);
    const newIdu = this.currentVisit.idus.find(i => i.id === newIduId);
    if (!linkMeta || !newIdu) return;

    if (linkMeta.iduId === newIduId) return;

    // Confirmation obligatoire avant de déplacer un link vers un autre IDU
    const confirmed = confirm(
      `Déplacer le link "${linkMeta.name}" vers ${newIdu.name} ?\n\n` +
      `Les éléments d'inspection Indoor et les photos IDU de ce link seront désormais rattachés à ${newIdu.name}.`
    );
    if (!confirmed) {
      this.renderVisitTab();
      return;
    }

    // Avertir si moins de 80% des éléments Indoor/Geotag IDU sont communs avec le groupe
    try {
      const linkData = (this.currentLinkId === linkId)
        ? { structure: this.currentStructure }
        : await window.pmDB.getState(`visit_${this.currentVisit.id}_link_${linkId}`);

      if (linkData && linkData.structure && newIdu.fingerprint && newIdu.fingerprint.length > 0) {
        const linkFp = window.visitManager.computeIduFingerprint(linkData.structure, this.currentVisit.scopeOverrides);
        const ratio = window.visitManager.compareFingerprints(newIdu.fingerprint, linkFp);
        if (ratio < 0.8) {
          alert(`Attention : structure différente (${Math.round(ratio * 100)}% d'éléments communs avec ${newIdu.name}), est-ce le même IDU ?`);
        }
      }
    } catch (e) {
      console.warn("Erreur vérification empreinte IDU:", e);
    }

    linkMeta.iduId = newIduId;

    // Si c'est le link actif, recharger les données du nouvel IDU et recomposer formData
    if (this.currentLinkId === linkId) {
      this.currentIduId = newIduId;
      this.currentIduData = (await window.pmDB.getState(`visit_${this.currentVisit.id}_idu_${newIduId}`)) || {
        id: newIduId,
        inspections: {},
        geotags: {}
      };

      const linkRecord = await window.pmDB.getState(`visit_${this.currentVisit.id}_link_${linkId}`);
      if (linkRecord) {
        this.formData = window.visitManager.composeFormData(
          this.currentVisit,
          this.currentSiteData,
          this.currentIduData,
          linkRecord,
          this.currentStructure
        );
        this.applyFormDataToInputs();
        this.renderAllViews();
      }
    }

    await window.pmDB.saveState(`visit_${this.currentVisit.id}`, this.currentVisit);
    this.renderVisitTab();
    this.updateVisitBanner();
    this.showToast(` Link affecté à ${newIdu.name}`);
  }

  // -------------------------------------------------------------
  // Création d'un nouvel IDU
  // -------------------------------------------------------------
    async createNewIdu(name) {
    if (!this.currentVisit) return;
    const clean = String(name || '').trim();
    if (!clean) return;
    if (this.currentVisit.idus.some(i => i.name.trim().toLowerCase() === clean.toLowerCase())) {
      alert(`Un groupe nommé "${clean}" existe déjà.`);
      return;
    }
    const newIdu = window.visitManager.createIdu(clean);
    this.currentVisit.idus.push(newIdu);
    await window.pmDB.saveState(`visit_${this.currentVisit.id}_idu_${newIdu.id}`, {
      id: newIdu.id,
      inspections: {},
      geotags: {}
    });
    await window.pmDB.saveState(`visit_${this.currentVisit.id}`, this.currentVisit);
    this.renderVisitTab();
    this.showToast(`Groupe "${newIdu.name}" créé`);
  }

  // Renommer un groupe IDU
  async renameIdu(iduId, newName) {
    const visit = this.currentVisit;
    if (!visit) return;
    const idu = visit.idus.find(i => i.id === iduId);
    const name = String(newName || '').trim();
    if (!idu || !name) return;
    if (visit.idus.some(i => i.id !== iduId && i.name.trim().toLowerCase() === name.toLowerCase())) {
      alert(`Un groupe nommé "${name}" existe déjà.`);
      return;
    }
    idu.name = name;
    await window.pmDB.saveState(`visit_${visit.id}`, visit);
    this.renderVisitTab();
    this.showToast(`Groupe renommé en "${name}"`);
  }

  // Supprimer un groupe IDU (seulement s'il ne contient aucun link)
  async deleteIdu(iduId) {
    const visit = this.currentVisit;
    if (!visit) return;
    if (visit.idus.length <= 1) {
      alert('Impossible de supprimer le seul groupe IDU de la visite.');
      return;
    }
    const idu = visit.idus.find(i => i.id === iduId);
    if (!idu) return;
    if (visit.links.some(l => l.iduId === iduId)) {
      alert(`"${idu.name}" contient encore des link : déplacez-les d'abord vers un autre IDU.`);
      return;
    }
    const rec = await window.pmDB.getState(`visit_${visit.id}_idu_${iduId}`);
    const nPhotos = Object.keys((rec && rec.geotags) || {}).length;
    if (nPhotos > 0 && !confirm(`"${idu.name}" contient ${nPhotos} photo(s) enregistrée(s) qui seront perdues. Supprimer quand même ?`)) {
      return;
    }
    await window.pmDB.deleteState(`visit_${visit.id}_idu_${iduId}`);
    visit.idus = visit.idus.filter(i => i.id !== iduId);
    if (visit.iduSummaries) delete visit.iduSummaries[iduId];
    await window.pmDB.saveState(`visit_${visit.id}`, visit);
    this.renderVisitTab();
    this.showToast(`Groupe "${idu.name}" supprimé`);
  }

  // -------------------------------------------------------------
  // Suppression d'un link
  // -------------------------------------------------------------
  async deleteLink(linkId) {
    const visit = this.currentVisit;
    if (!visit || visit.links.length <= 1) {
      alert("Impossible de supprimer le seul link de la visite. Utilisez « Nouvelle visite » pour recommencer.");
      return;
    }
    const linkMeta = visit.links.find(l => l.id === linkId);
    if (!linkMeta) return;

    const s = linkMeta.summary || (visit.linkSummaries && visit.linkSummaries[linkId]) || {};
    const lost = (s.photosPrises || 0) > 0
      ? `\n\nAttention : ${s.photosPrises} photo(s) déjà prise(s) pour ce link seront perdues.` : '';
    if (!confirm(`Supprimer définitivement le link "${linkMeta.name}" de la visite ?${lost}`)) return;

    // Enregistrer d'abord les données communes (site, IDU) saisies depuis ce link
    await this.flushAutoSave();

    // Empêcher toute sauvegarde différée de réécrire le link supprimé
    if (this.autoSaveTimer) { clearTimeout(this.autoSaveTimer); this.autoSaveTimer = null; }
    const wasActive = (this.currentLinkId === linkId);
    if (wasActive) this.currentLinkId = null;

    const idx = visit.links.findIndex(l => l.id === linkId);
    try {
      if (window.pmDB && typeof window.pmDB.deleteState === 'function') {
        await window.pmDB.deleteState(`visit_${visit.id}_link_${linkId}`);
      }
    } catch (e) {
      console.warn('Suppression du link dans IndexedDB :', e);
    }

    visit.links = visit.links.filter(l => l.id !== linkId);
    if (visit.linkSummaries) delete visit.linkSummaries[linkId];
    if (visit.activeLinkId === linkId) visit.activeLinkId = null;
    await window.pmDB.saveState(`visit_${visit.id}`, visit);

    if (wasActive) {
      const next = visit.links[Math.min(idx, visit.links.length - 1)];
      await this.openLink(next.id);
    } else {
      this.renderVisitTab();
      this.updateVisitBanner();
    }
    this.showToast(` Link "${linkMeta.name}" supprimé`);
  }

  // Navigation between mobile tabs
  setupNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTabId = tab.getAttribute('data-tab');
        this.switchTab(targetTabId);
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const activeNav = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
    const activeContent = document.getElementById(tabId);

    if (activeNav) activeNav.classList.add('active');
    if (activeContent) activeContent.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabId === 'tab-visit') {
      this.renderVisitTab();
    } else if (tabId === 'tab-field') {
      this.buildWizardItemsList();
      this.renderWizardActiveItem();
    } else if (tabId === 'tab-radio') {
      this.renderRadioConfig();
    } else if (tabId === 'tab-structure') {
      this.renderStructureEditor();
    } else if (tabId === 'tab-free-grid') {
      this.renderFreeModeGrid();
    } else if (tabId === 'tab-export') {
      this.refreshReadiness();
      this.loadSavedReportsList();
    } else if (tabId === 'tab-radio') {
      this.renderRadioEditor();
    } 
  }

  // Bind UI inputs to formData
  bindInputs() {
    const commonFields = [
      ['inputSiteName', 'siteName'],
      ['inputProjectName', 'projectName'],
      ['inputHopName', 'hopName'],
      ['inputSiteA', 'siteA'],
      ['inputSiteB', 'siteB'],
      ['inputClient', 'client'],
      ['inputPartner', 'partner'],
      ['inputCountry', 'country'],
      ['inputDate', 'date'],
      ['inputTTRef', 'ttRef'],
      ['inputPMDesc', 'pmDescription'],
      ['inputFoeName', 'foeName'],
      ['inputFoeContact', 'foeContact'],
      ['inputSiteLong', 'siteLong'],
      ['inputSiteLat', 'siteLat']
    ];

    commonFields.forEach(([elemId, key]) => {
      const el = document.getElementById(elemId);
      if (el) {
        el.addEventListener('input', (e) => {
          this.formData.common[key] = e.target.value;
          if (key === 'siteName') {
            document.getElementById('currentSiteLabel').textContent = e.target.value || 'Site PM';
          }
          if (key === 'foeName') {
            document.getElementById('sigFoeNameDisplay').textContent = e.target.value || 'ELIE';
          }
          this.autoSave();
        });
      }
    });

    // Link Status Radios
    const linkRadios = document.querySelectorAll('input[name="linkStatusOption"]');
    linkRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.formData.cover.linkStatusOption = e.target.value;
        this.autoSave();
      });
    });

    // Snags counts
    document.getElementById('inputMinorSnagsCount')?.addEventListener('input', (e) => {
      this.formData.cover.minorSnagsItemsCount = e.target.value;
      this.autoSave();
    });
    document.getElementById('inputMinorSnagsPage')?.addEventListener('input', (e) => {
      this.formData.cover.minorSnagsPageNo = e.target.value;
      this.autoSave();
    });
    document.getElementById('inputMajorAlarmsCount')?.addEventListener('input', (e) => {
      this.formData.cover.majorAlarmsItemsCount = e.target.value;
      this.autoSave();
    });
    document.getElementById('inputMajorAlarmsPage')?.addEventListener('input', (e) => {
      this.formData.cover.majorAlarmsPageNo = e.target.value;
      this.autoSave();
    });

    // Radio System Configuration & Frequency Plan Inputs
    const radioFields = [
      ['inputRadioEquipment', 'equipment'],
      ['inputRadioLinkConfig', 'linkConfig'],
      ['inputRadioE1Mapping', 'e1Mapping'],
      ['inputRadioStm1Mapping', 'stm1Mapping'],
      ['inputRadioEthernetBw', 'ethernetBw'],
      ['inputRadioTxFreq', 'txFreq'],
      ['inputRadioRxFreq', 'rxFreq'],
      ['inputRadioChannelSpacing', 'channelSpacing'],
      ['inputRadioModulation', 'modulation'],
      ['inputRadioSiteHigh', 'siteHigh'],
      ['inputRadioSiteLow', 'siteLow']
    ];

    radioFields.forEach(([elemId, key]) => {
      const el = document.getElementById(elemId);
      if (el) {
        el.addEventListener('input', (e) => {
          this.formData.radio = this.formData.radio || { configValues: {}, tests: {} };
          this.formData.radio.configValues = this.formData.radio.configValues || {};
          this.formData.radio.configValues[key] = e.target.value;
          this.autoSave();
        });
      }
    });
  }

  applyFormDataToInputs() {
    const common = this.formData.common || {};
    const map = {
      inputSiteName: common.siteName,
      inputProjectName: common.projectName,
      inputHopName: common.hopName,
      inputSiteA: common.siteA,
      inputSiteB: common.siteB,
      inputClient: common.client,
      inputPartner: common.partner,
      inputCountry: common.country,
      inputDate: common.date,
      inputTTRef: common.ttRef,
      inputPMDesc: common.pmDescription,
      inputFoeName: common.foeName,
      inputFoeContact: common.foeContact,
      inputSiteLong: common.siteLong,
      inputSiteLat: common.siteLat
    };

    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.value = val;
    }

    if (common.siteName) {
      document.getElementById('currentSiteLabel').textContent = common.siteName;
    }
    if (common.foeName) {
      document.getElementById('sigFoeNameDisplay').textContent = common.foeName;
    }

    const statusVal = this.formData.cover?.linkStatusOption || 'fine';
    const targetRadio = document.querySelector(`input[name="linkStatusOption"][value="${statusVal}"]`);
    if (targetRadio) targetRadio.checked = true;

    // Apply Radio Config inputs
    const radioCfg = (this.formData.radio && this.formData.radio.configValues) || {};
    const radioMap = {
      inputRadioEquipment: radioCfg.equipment,
      inputRadioLinkConfig: radioCfg.linkConfig,
      inputRadioE1Mapping: radioCfg.e1Mapping,
      inputRadioStm1Mapping: radioCfg.stm1Mapping,
      inputRadioEthernetBw: radioCfg.ethernetBw,
      inputRadioTxFreq: radioCfg.txFreq,
      inputRadioRxFreq: radioCfg.rxFreq,
      inputRadioChannelSpacing: radioCfg.channelSpacing,
      inputRadioModulation: radioCfg.modulation,
      inputRadioSiteHigh: radioCfg.siteHigh,
      inputRadioSiteLow: radioCfg.siteLow
    };
    for (const [id, val] of Object.entries(radioMap)) {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.value = val;
    }

    const btnLow = document.getElementById('btnRadioRoleLow');
    const btnHigh = document.getElementById('btnRadioRoleHigh');
    if (radioCfg.siteHigh === 'HIGH') {
      if (btnHigh) { btnHigh.style.background = 'var(--primary)'; btnHigh.style.color = '#fff'; btnHigh.style.fontWeight = '700'; }
      if (btnLow) { btnLow.style.background = 'transparent'; btnLow.style.color = 'var(--text-muted)'; btnLow.style.fontWeight = 'normal'; }
    } else {
      if (btnLow) { btnLow.style.background = 'var(--primary)'; btnLow.style.color = '#fff'; btnLow.style.fontWeight = '700'; }
      if (btnHigh) { btnHigh.style.background = 'transparent'; btnHigh.style.color = 'var(--text-muted)'; btnHigh.style.fontWeight = 'normal'; }
    }
  }

  // Setup button handlers
  setupEvents() {
    // -------------------------------------------------------------
    // Import de templates (multiple) & visite multi-link
    // -------------------------------------------------------------
    const fileInput = document.getElementById('templateFileInput');
    const btnImport = document.getElementById('btnImportTemplate');
    btnImport.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      try {
        await this.handleTemplatesImport(files, false);
      } finally {
        fileInput.value = "";
      }
    });

    // Bouton aller à la visite depuis le bandeau haut
    document.getElementById('btnBannerGoToVisit')?.addEventListener('click', () => {
      this.switchTab('tab-visit');
    });

    // Navigation directe entre link depuis le bandeau haut (Règle 3)
    document.getElementById('btnBannerPrevLink')?.addEventListener('click', async () => {
      await this.navigateToAdjacentLink(-1);
    });
    document.getElementById('btnBannerNextLink')?.addEventListener('click', async () => {
      await this.navigateToAdjacentLink(1);
    });

    // Écran Suivi : Bouton "Continuer" (prochain élément manquant)
    document.getElementById('btnTrackingContinue')?.addEventListener('click', async () => {
      await this.continueNextMissingItem();
    });

    // Écran Suivi : Aller aux champs du site
    document.getElementById('btnGoToSiteFields')?.addEventListener('click', () => {
      this.switchTab('tab-cover');
    });

    // Écran Suivi : Recherche par nom de link
    document.getElementById('trackingSearchInput')?.addEventListener('input', (e) => {
      this.trackingSearchQuery = (e.target.value || '').trim().toLowerCase();
      this.renderTrackingSection();
    });

    // Écran Suivi : Filtres Tous / Incomplets / Complets
    const trackingPills = document.querySelectorAll('.filter-pill[data-filter]');
    trackingPills.forEach(pill => {
      pill.addEventListener('click', () => {
        trackingPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.trackingFilter = pill.getAttribute('data-filter') || 'all';
        this.renderTrackingSection();
      });
    });

    // Ajouter des link (.xlsx) depuis l'onglet Visite
    const addLinksInput = document.getElementById('addLinksFileInput');
    const btnAddLinks = document.getElementById('btnAddLinksToVisit');
    if (btnAddLinks && addLinksInput) {
      btnAddLinks.addEventListener('click', () => addLinksInput.click());
      addLinksInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
          await this.handleTemplatesImport(files, true);
        } finally {
          addLinksInput.value = "";
        }
      });
    }

    // Nouvelle visite depuis l'onglet Visite
    document.getElementById('btnNewVisitFromTab')?.addEventListener('click', () => {
      if (!this.prepareForNewTemplate()) return;
      fileInput.click();
    });

    // Nouvel IDU depuis l'onglet Visite
    document.getElementById('btnNewIduModal')?.addEventListener('click', async () => {
      const count = (this.currentVisit?.idus?.length || 0) + 1;
      const name = prompt("Nom du nouvel IDU :", `IDU ${count}`);
      if (name && name.trim()) {
        await this.createNewIdu(name.trim());
      }
    });

    // Exporter la visite avec dialogue de sélection (Règle 5 & 6)
    document.getElementById('btnExportVisit')?.addEventListener('click', async () => {
      await this.showExportOptionsModal();
    });

    // -------------------------------------------------------------
    // Point 1: Load sample template button with embedded Base64 fallback
    // -------------------------------------------------------------
    document.getElementById('btnLoadSampleTemplate').addEventListener('click', async () => {
      if (!this.prepareForNewTemplate()) return;
      await this.loadSampleTemplate();
    });

    // Copy from previous PM button
    document.getElementById('btnCopyPreviousPM')?.addEventListener('click', async () => {
      await this.copyFromPreviousPM();
    });

    // Point 3: GPS Acquisition strictly for Cover page
    document.getElementById('btnAcquireGPS').addEventListener('click', async () => {
      await this.acquireGPS();
    });

    // Inspection batch buttons
    document.getElementById('btnSetAllOk').addEventListener('click', () => {
      this.setAllInspectionStatus('OK');
    });
    document.getElementById('btnSetAllNA').addEventListener('click', () => {
      this.setAllInspectionStatus('NA');
    });

    // -------------------------------------------------------------
    // Point 2: Distinct Camera & Gallery inputs
    // -------------------------------------------------------------
    const cameraInput = document.getElementById('photoCameraInput');
    const galleryInput = document.getElementById('photoGalleryInput');

    // Camera: single file without multiple attribute
    cameraInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.handleCameraFileSelected(file);
      }
      cameraInput.value = ""; // reset for next capture
    });

    // Gallery: multiple files selection
    galleryInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await this.handleGalleryFilesSelected(e.target.files);
      }
      galleryInput.value = ""; // reset for next pick
    });

    // Photo Preview Modal
    document.getElementById('btnClosePhotoModal').addEventListener('click', () => {
      document.getElementById('photoPreviewModal').classList.remove('active');
      this.pendingPhoto = null;
    });
    document.getElementById('btnRetakePhoto').addEventListener('click', () => {
      document.getElementById('photoPreviewModal').classList.remove('active');
      document.getElementById('photoCameraInput').click();
    });
    document.getElementById('btnConfirmPhoto').addEventListener('click', () => {
      this.confirmPendingPhoto();
    });

    // Mandatory comment modal
    document.getElementById('btnCloseMandatoryComment').addEventListener('click', () => {
      document.getElementById('mandatoryCommentModal').classList.remove('active');
      this.pendingNotOkTarget = null;
    });
    document.getElementById('btnConfirmMandatoryComment').addEventListener('click', () => {
      this.confirmMandatoryComment();
    });

    // Duplicate Sheet Modal
    document.getElementById('btnDuplicateSheetModal').addEventListener('click', () => {
      this.openDuplicateSheetModal();
    });
    document.getElementById('btnCloseDupSheetModal').addEventListener('click', () => {
      document.getElementById('duplicateSheetModal').classList.remove('active');
    });
    document.getElementById('btnConfirmDuplicateSheet').addEventListener('click', () => {
      this.confirmDuplicateSheet();
    });


    // Free Mode Grid Handlers
    document.getElementById('freeModeSheetSelect').addEventListener('change', () => {
      this.renderFreeModeGrid();
    });
    document.getElementById('btnCloseFreeCellModal').addEventListener('click', () => {
      document.getElementById('freeCellModal').classList.remove('active');
    });
    document.getElementById('btnFreeCellOk').addEventListener('click', () => {
      document.getElementById('freeCellTextInput').value = 'OK';
    });
    document.getElementById('btnFreeCellNA').addEventListener('click', () => {
      document.getElementById('freeCellTextInput').value = 'NA';
    });
    document.getElementById('btnFreeCellNotOk').addEventListener('click', () => {
      document.getElementById('freeCellTextInput').value = 'NOT OK';
    });
    document.getElementById('btnSaveFreeCell').addEventListener('click', () => {
      this.saveFreeCell();
    });
    // Radio Performance & Tests Actions
    document.getElementById('btnRadioAddPort')?.addEventListener('click', () => {
      this.addRadioPort();
    });
    document.getElementById('btnRadioAddTest')?.addEventListener('click', () => {
      this.addRadioTest();
    });
    document.getElementById('btnRadioSetAllOk')?.addEventListener('click', () => {
      this.setRadioPort1AllOk();
    });
    document.getElementById('btnRadioSetInactiveNA')?.addEventListener('click', () => {
      this.setRadioInactivePortsNA();
    });
    document.getElementById('btnRadioSetAllNA')?.addEventListener('click', () => {
      this.setRadioAllNA();
    });
    document.getElementById('btnRadioViewCards')?.addEventListener('click', () => {
      this.toggleRadioViewMode('cards');
    });
    document.getElementById('btnRadioViewTable')?.addEventListener('click', () => {
      this.toggleRadioViewMode('table');
    });
    document.getElementById('btnRadioRoleLow')?.addEventListener('click', () => {
      this.setRadioSiteRole('LOW');
    });
    document.getElementById('btnRadioRoleHigh')?.addEventListener('click', () => {
      this.setRadioSiteRole('HIGH');
    });

    // Export Buttons
    document.getElementById('btnExportAndShare').addEventListener('click', async () => {
      await this.exportReport(true);
    });
    document.getElementById('btnDirectDownload').addEventListener('click', async () => {
      await this.exportReport(false);
    });
  }

  // -------------------------------------------------------------
  // Point 1: Load bundled Nokia PM template
  // Fills templateBuffer from embedded base64 or local asset, then runs analysis
  // -------------------------------------------------------------
  async loadSampleTemplate() {
    try {
      let buf = null;
      if (window.NOKIA_SAMPLE_TEMPLATE_B64) {
        buf = this.base64ToArrayBuffer(window.NOKIA_SAMPLE_TEMPLATE_B64);
      } else {
        const resp = await fetch('samples/nokia_pm_template.xlsx');
        if (!resp.ok) throw new Error('Fichier template de démo introuvable');
        buf = await resp.arrayBuffer();
      }

      const name = 'Nokia_MSS_HE_PM_Demo.xlsx';
      this.setTemplateBuffer(buf);
      this.setTemplateName(name);

      await this.processWorkbookBuffer(buf);
      this.showToast('Nokia MSS HE Demo Template chargé avec succès !');
    } catch (err) {
      console.error('Erreur chargement template démo:', err);
      alert('Erreur lors du chargement du template démo : ' + (err.message || err));
    }
  }

  // Parse workbook using ExcelJS & dynamic analyzer
  async processWorkbookBuffer(buffer) {
    try {
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(buffer);

      this.currentStructure = window.excelTemplateAnalyzer.analyzeWorkbook(wb);

      this.renderSummary(this.currentStructure.summary);
      this.extractInitialValuesFromTemplate(this.currentStructure);

      // Assurer l'existence d'une visite pour le link
      if (!this.currentVisit) {
        const siteName = this.formData.common.siteName || 'Site PM';
        const visit = window.visitManager.createVisit(siteName);
        const idu = window.visitManager.createIdu('IDU 1');
        visit.idus.push(idu);

        const linkId = 'link_' + Date.now();
        const hopName = this.formData.common.hopName || this.templateName || 'Hop 1';
        visit.links.push({
          id: linkId,
          name: hopName,
          iduId: idu.id,
          templateName: this.templateName || 'Site_Template.xlsx'
        });
        visit.activeLinkId = linkId;

        this.currentVisit = visit;
        this.currentLinkId = linkId;
        this.currentIduId = idu.id;
      } else if (this.currentLinkId) {
        const currentLink = this.currentVisit.links.find(l => l.id === this.currentLinkId);
        if (currentLink) {
          currentLink.templateName = this.templateName;
          if (this.formData.common.hopName) currentLink.name = this.formData.common.hopName;
        }
      }

      this.renderAllViews();
      await this.autoSave(true);
      this.vibrate(50);
    } catch (err) {
      console.error('Error processing workbook:', err);
      alert('Error parsing Excel template: ' + err.message);
    }
  }
  // Valeurs de la feuille Radio config lues dans le template (équipement, fréquences, modulation...)
  extractRadioConfigValues(structure) {
    const out = {};
    const sheet = ((structure && structure.sheets) || []).find(s => s.type === 'RADIO_CONFIG');
    const cf = sheet && sheet.content && sheet.content.configFields;
    if (cf) {
      Object.entries(cf).forEach(([key, f]) => {
        const v = (f && f.initialValue !== undefined && f.initialValue !== null)
          ? String(f.initialValue).trim() : '';
        if (v) out[key] = v;
      });
    }
    return out;
  }
  extractInitialValuesFromTemplate(structure) {
    const common = this.formData.common;
    // Le template fait foi : une valeur non vide du template remplace celle du formulaire
    const take = (key, v) => {
      if (v === undefined || v === null) return;
      const s = String(v).trim();
      if (!s || /[:=]\s*$/.test(s)) return;     // ignore un libellé pris pour une valeur
      common[key] = s;
    };

    for (const sheet of structure.sheets) {
      if (sheet.type === 'COVER' && sheet.content && sheet.content.fields) {
        const f = sheet.content.fields;
        take('siteLong', f.siteLong?.initialValue);
        take('siteLat', f.siteLat?.initialValue);
        take('siteA', f.siteAName?.initialValue);
        take('siteB', f.siteBName?.initialValue);
        take('ttRef', f.note?.initialValue);
        take('pmDescription', f.pmDescription?.initialValue);
        take('hopName', f.hopName?.initialValue);
      }
      if (sheet.commonHeader) {
        const ch = sheet.commonHeader;
        take('siteName', ch.siteNameCell?.initialValue);
        take('hopName', ch.hopNameCell?.initialValue);
        take('client', ch.clientCell?.initialValue);
        take('partner', ch.partnerCell?.initialValue);
        take('country', ch.countryCell?.initialValue);
        take('projectName', ch.projectCell?.initialValue);
      }
      if (sheet.signatureBlock) {
        take('foeName', sheet.signatureBlock.foeNameCell?.initialValue);
        take('foeContact', sheet.signatureBlock.foeContactCell?.initialValue);
      }
    }

    // Site A / Site B vides : déduits du hop "A TO B"
    if (common.hopName && (!common.siteA || !common.siteB)) {
      const parts = common.hopName.split(/\s+to\s+/i);
      if (parts.length === 2) {
        if (!common.siteA) common.siteA = parts[0].trim();
        if (!common.siteB) common.siteB = parts[1].trim();
      }
    }
    const rcv = this.extractRadioConfigValues(structure);
    if (Object.keys(rcv).length > 0) {
      this.formData.radio = this.formData.radio || { configValues: {}, tests: {} };
      this.formData.radio.configValues = Object.assign({}, this.formData.radio.configValues || {}, rcv);
    }
    this.applyFormDataToInputs();
  }

  renderSummary(summary) {
    document.getElementById('templateAnalysisSummary').style.display = 'block';
    document.getElementById('sumSheetsCount').textContent = summary.totalSheets;
    document.getElementById('sumInspCount').textContent = summary.totalInspectionItems;
    document.getElementById('sumPhotoCount').textContent = summary.totalPhotoSlots;
    document.getElementById('sumMonCount').textContent = summary.totalMonitoringSlots;

    const warningsContainer = document.getElementById('templateWarnings');
    warningsContainer.innerHTML = '';
    if (summary.warnings && summary.warnings.length > 0) {
      summary.warnings.forEach(w => {
        const alert = document.createElement('div');
        alert.className = 'alert alert-info';
        alert.textContent = 'ℹ ' + w;
        warningsContainer.appendChild(alert);
      });
    }
  }

  renderAllViews() {
    this.renderRadioConfig();
    this.renderInspectionSheets();
    this.renderGeotagSheets();
    this.buildWizardItemsList();
    this.renderWizardActiveItem();
    this.renderStructureEditor();
    this.renderFreeModeGrid();
    this.updateGeotagProgress();
    this.renderRadioEditor();
    this.renderVisitTab();
    this.updateVisitBanner();
  }

  // ==========================================
  // SECTION: Radio Configuration & Performance Tests
  // ==========================================
  toggleRadioViewMode(mode) {
    const cardsCont = document.getElementById('radioTestsCardsContainer');
    const tableCont = document.getElementById('radioTestsTableContainer');
    const btnCards = document.getElementById('btnRadioViewCards');
    const btnTable = document.getElementById('btnRadioViewTable');

    if (mode === 'cards') {
      if (cardsCont) cardsCont.style.display = 'block';
      if (tableCont) tableCont.style.display = 'none';
      if (btnCards) { btnCards.style.background = 'var(--primary)'; btnCards.style.color = '#fff'; }
      if (btnTable) { btnTable.style.background = 'transparent'; btnTable.style.color = 'var(--text-main)'; }
    } else {
      if (cardsCont) cardsCont.style.display = 'none';
      if (tableCont) tableCont.style.display = 'block';
      if (btnCards) { btnCards.style.background = 'transparent'; btnCards.style.color = 'var(--text-main)'; }
      if (btnTable) { btnTable.style.background = 'var(--primary)'; btnTable.style.color = '#fff'; }
    }
  }

  setRadioTestPortValue(testNo, portLabel, value) {
    this.formData.radio = this.formData.radio || { configValues: {}, tests: {} };
    this.formData.radio.tests = this.formData.radio.tests || {};
    this.formData.radio.tests[testNo] = this.formData.radio.tests[testNo] || {};
    this.formData.radio.tests[testNo][portLabel] = value;
    this.autoSave();

    const safePortId = portLabel.replace(/[^a-zA-Z0-9]/g, '_');

    // Update Card input
    const input = document.getElementById(`radio_in_${testNo}_${safePortId}`);
    if (input && input.value !== value) input.value = value;

    // Update Table input
    const tblInput = document.getElementById(`radio_tbl_${testNo}_${safePortId}`);
    if (tblInput && tblInput.value !== value) tblInput.value = value;

    // Update chip styling in Card mode
    const row = document.getElementById(`radio_row_${testNo}_${safePortId}`);
    if (row) {
      row.querySelectorAll('.radio-chip').forEach(c => {
        const chipVal = c.getAttribute('data-val');
        c.className = 'radio-chip';
        if (chipVal === value) {
          if (value === 'OK') c.classList.add('active-ok');
          else if (value === 'NA') c.classList.add('active-na');
          else if (value === 'NOT OK') c.classList.add('active-notok');
          else c.classList.add('active-val');
        }
      });
    }
  }

  setAllPortsForTest(testNo, status) {
    const sheet = this.currentStructure?.sheets.find(s => s.type === 'RADIO_CONFIG');
    const table = sheet?.content?.testTable;
    const ports = table?.columns?.portCols || [];
    if (ports.length > 0) {
      ports.forEach(p => this.setRadioTestPortValue(testNo, p.label, status));
    } else {
      for (let i = 1; i <= 8; i++) {
        this.setRadioTestPortValue(testNo, `ODU Port${i}`, status);
      }
    }
    this.showToast(`Test #${testNo}: All ports set to ${status}`);
    this.vibrate(30);
  }

  setRadioPort1AllOk() {
    const sheet = this.currentStructure?.sheets.find(s => s.type === 'RADIO_CONFIG');
    const tests = sheet?.content?.testTable?.tests || [
      { no: 1, item: 'Visual Inspection' },
      { no: 2, item: 'GBE/FE Signal' },
      { no: 3, item: 'Receive Signal Level' },
      { no: 4, item: 'PM View' }
    ];
    tests.forEach(t => {
      if (t.no === 3 || /signal|rsl|level/i.test(t.item)) {
        const cur = this.formData.radio?.tests?.[t.no]?.['ODU Port1'];
        if (!cur || cur === 'OK') this.setRadioTestPortValue(t.no, 'ODU Port1', '-37.9 dBm');
      } else {
        this.setRadioTestPortValue(t.no, 'ODU Port1', 'OK');
      }
    });
    this.showToast('ODU Port 1 configured: Tests OK & RSL Nominal (-37.9 dBm)');
    this.vibrate(50);
  }

  setRadioInactivePortsNA() {
    const sheet = this.currentStructure?.sheets.find(s => s.type === 'RADIO_CONFIG');
    const table = sheet?.content?.testTable;
    const ports = table?.columns?.portCols || [];
    const tests = table?.tests || [
      { no: 1 }, { no: 2 }, { no: 3 }, { no: 4 }
    ];
    let count = 0;
    const portList = ports.length > 0 ? ports : [
      { label: 'ODU Port1' }, { label: 'ODU Port2' }, { label: 'ODU Port3' }, { label: 'ODU Port4' },
      { label: 'ODU Port5' }, { label: 'ODU Port6' }, { label: 'ODU Port7' }, { label: 'ODU Port8' }
    ];

    portList.forEach(p => {
      if (p.label !== 'ODU Port1' && p.label !== 'ODU Port 1') {
        tests.forEach(t => {
          this.setRadioTestPortValue(t.no, p.label, 'NA');
          count++;
        });
      }
    });
    this.showToast(`Ports 2..8 set to NA (${count} cells updated)`);
    this.vibrate(40);
  }

  setRadioAllNA() {
    const sheet = this.currentStructure?.sheets.find(s => s.type === 'RADIO_CONFIG');
    const table = sheet?.content?.testTable;
    const ports = table?.columns?.portCols || [];
    const tests = table?.tests || [{ no: 1 }, { no: 2 }, { no: 3 }, { no: 4 }];
    const portList = ports.length > 0 ? ports : [
      { label: 'ODU Port1' }, { label: 'ODU Port2' }, { label: 'ODU Port3' }, { label: 'ODU Port4' },
      { label: 'ODU Port5' }, { label: 'ODU Port6' }, { label: 'ODU Port7' }, { label: 'ODU Port8' }
    ];

    portList.forEach(p => {
      tests.forEach(t => {
        this.setRadioTestPortValue(t.no, p.label, 'NA');
      });
    });
    this.showToast('All Radio tests set to NA');
    this.vibrate(40);
  }

  addRadioPort() {
    if (!this.currentStructure) {
      alert('Please load or import an Excel template first.');
      return;
    }
    const sheet = this.currentStructure.sheets.find(s => s.type === 'RADIO_CONFIG');
    const currentCount = sheet?.content?.testTable?.columns?.portCols?.length || 8;
    const nextLabel = `ODU Port${currentCount + 1}`;
    const name = prompt('Enter new ODU Port Label:', nextLabel);
    if (!name) return;

    window.excelTemplateAnalyzer.addRadioPortColumn(this.currentStructure, name);
    this.renderRadioConfig();
    this.showToast(`Added ${name} column`);
    this.vibrate(50);
  }

  /*addRadioTest() {
    if (!this.currentStructure) {
      alert('Please load or import an Excel template first.');
      return;
    }
    const name = prompt('Test Item Name:', 'BER & Throughput Test');
    if (!name) return;
    const spec = prompt('Specification:', 'No bit error detected');
    const equip = prompt('Test Equipment:', 'LCT Web / Analyzer');

    window.excelTemplateAnalyzer.addRadioTestItem(this.currentStructure, name, spec || 'Satisfactory', equip || 'Monitoring');
    this.renderRadioConfig();
    this.showToast(`Added test "${name}"`);
    this.vibrate(50);
  }*/

  setRadioSiteRole(role) {
    this.formData.radio = this.formData.radio || { configValues: {}, tests: {} };
    this.formData.radio.configValues = this.formData.radio.configValues || {};

    const highInput = document.getElementById('inputRadioSiteHigh');
    const lowInput = document.getElementById('inputRadioSiteLow');
    const btnLow = document.getElementById('btnRadioRoleLow');
    const btnHigh = document.getElementById('btnRadioRoleHigh');

    if (role === 'LOW') {
      this.formData.radio.configValues.siteHigh = '';
      this.formData.radio.configValues.siteLow = 'LOW';
      if (highInput) highInput.value = '';
      if (lowInput) lowInput.value = 'LOW';
      if (btnLow) { btnLow.style.background = 'var(--primary)'; btnLow.style.color = '#fff'; btnLow.style.fontWeight = '700'; }
      if (btnHigh) { btnHigh.style.background = 'transparent'; btnHigh.style.color = 'var(--text-muted)'; btnHigh.style.fontWeight = 'normal'; }
    } else {
      this.formData.radio.configValues.siteHigh = 'HIGH';
      this.formData.radio.configValues.siteLow = '';
      if (highInput) highInput.value = 'HIGH';
      if (lowInput) lowInput.value = '';
      if (btnHigh) { btnHigh.style.background = 'var(--primary)'; btnHigh.style.color = '#fff'; btnHigh.style.fontWeight = '700'; }
      if (btnLow) { btnLow.style.background = 'transparent'; btnLow.style.color = 'var(--text-muted)'; btnLow.style.fontWeight = 'normal'; }
    }
    this.autoSave();
  }

  setActiveRadioPort(portLabel) {
    this.activeRadioPort = portLabel;
    this.renderRadioConfig();
  }

  renderRadioConfig() {
    const badge = document.getElementById('radioSheetDetectedBadge');
    const cardsCont = document.getElementById('radioTestsCardsContainer');
    const tableCont = document.getElementById('radioTestsTableContainer');

    if (!cardsCont) return;

    const sheet = this.currentStructure?.sheets.find(s => s.type === 'RADIO_CONFIG');
    if (badge) {
      if (sheet) {
        badge.textContent = `Sheet: ${sheet.name}`;
        badge.className = 'badge badge-accent';
      } else {
        badge.textContent = 'Manual Config';
        badge.className = 'badge badge-outline';
      }
    }

    const defaultPorts = [];
    for (let i = 1; i <= 8; i++) defaultPorts.push({ col: 4 + i, label: `ODU Port${i}` });

    const portCols = sheet?.content?.testTable?.columns?.portCols?.length
      ? sheet.content.testTable.columns.portCols
      : defaultPorts;

    const tests = sheet?.content?.testTable?.tests?.length
      ? sheet.content.testTable.tests
      : [
          { no: 1, item: 'Visual Inspection', spec: 'Satisfactory', equipment: 'Human inspection', ports: {} },
          { no: 2, item: 'GBE/FE Signal', spec: 'All the throughput transmitted are received at opposite site without error', equipment: 'GBE Tester WEB LCT', ports: {} },
          { no: 3, item: 'Receive Signal Level', spec: 'Design RSL ± 3dBm', equipment: 'Monitoring', ports: {} },
          { no: 4, item: 'PM View', spec: 'Air Loss (s)', equipment: 'Monitoring', ports: {} }
        ];

    this.formData.radio = this.formData.radio || { configValues: {}, tests: {} };
    this.formData.radio.tests = this.formData.radio.tests || {};

    this.activeRadioPort = this.activeRadioPort || 'ODU Port1';

    // 1. Render Port Selector Tabs
    let portTabsHtml = `
      <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 12px; -webkit-overflow-scrolling: touch;">
    `;
    portCols.forEach(port => {
      const isSel = this.activeRadioPort === port.label;
      const bg = isSel ? 'var(--primary)' : 'var(--bg-surface-raised)';
      const color = isSel ? '#fff' : 'var(--text-main)';
      const border = isSel ? '1px solid var(--primary)' : '1px solid var(--border-color)';
      portTabsHtml += `
        <button type="button" class="btn btn-sm" onclick="window.app.setActiveRadioPort(${jsArg(port.label)})"
          style="background: ${bg}; color: ${color}; border: ${border}; font-size: 12px; padding: 6px 12px; white-space: nowrap; font-weight: ${isSel ? '700' : '500'};">
          ${escapeHtml(port.label)}${port.label === 'ODU Port1' ? ' (Active)' : ''}
        </button>
      `;
    });
    const isAllSel = this.activeRadioPort === 'all';
    portTabsHtml += `
      <button type="button" class="btn btn-sm" onclick="window.app.setActiveRadioPort('all')"
        style="background: ${isAllSel ? 'var(--accent)' : 'var(--bg-surface-raised)'}; color: ${isAllSel ? '#000' : 'var(--text-muted)'}; border: 1px solid var(--border-color); font-size: 12px; padding: 6px 12px; white-space: nowrap; font-weight: ${isAllSel ? '700' : '500'};">
        All Ports (${portCols.length})
      </button>
    </div>`;

    // 2. Render Cards Mode
    const displayedPorts = this.activeRadioPort === 'all'
      ? portCols
      : portCols.filter(p => p.label === this.activeRadioPort);

    let cardsHtml = portTabsHtml;
    tests.forEach(test => {
      const isRsl = test.no === 3 || /signal|rsl|level/i.test(test.item);
      const testMap = this.formData.radio.tests[test.no] || {};

      let portsHtml = '';
      displayedPorts.forEach(port => {
        const val = testMap[port.label] !== undefined ? testMap[port.label] : (test.ports?.[port.label]?.value || '');
        const safePortId = port.label.replace(/[^a-zA-Z0-9]/g, '_');

        let chipsHtml = '';
        if (isRsl) {
          const presets = ['-35 dBm', '-37.9 dBm', '-40 dBm', '-45 dBm', 'OK', 'NA'];
          presets.forEach(pVal => {
            const isAct = val === pVal;
            const actClass = isAct ? (pVal === 'NA' ? 'active-na' : (pVal === 'OK' ? 'active-ok' : 'active-val')) : '';
            chipsHtml += `<button type="button" class="radio-chip ${actClass}" data-val="${escapeHtml(pVal)}" onclick="window.app.setRadioTestPortValue(${test.no}, ${jsArg(port.label)}, ${jsArg(pVal)})">${escapeHtml(pVal)}</button>`;
          });
        } else {
          const statuses = ['OK', 'NA', 'NOT OK'];
          statuses.forEach(sVal => {
            const isAct = val === sVal;
            const actClass = isAct ? (sVal === 'OK' ? 'active-ok' : (sVal === 'NA' ? 'active-na' : 'active-notok')) : '';
            chipsHtml += `<button type="button" class="radio-chip ${actClass}" data-val="${escapeHtml(sVal)}" onclick="window.app.setRadioTestPortValue(${test.no}, ${jsArg(port.label)}, ${jsArg(sVal)})">${escapeHtml(sVal)}</button>`;
          });
        }

        portsHtml += `
          <div class="radio-port-row" id="radio_row_${test.no}_${safePortId}" style="margin-bottom: 8px;">
            ${displayedPorts.length > 1 ? `<div class="radio-port-label" style="font-weight: 700; color: var(--accent); margin-bottom: 4px;">${escapeHtml(port.label)}</div>` : ''}
            <div class="radio-port-input-wrapper">
              <input type="text" class="radio-cell-input" id="radio_in_${test.no}_${safePortId}"
                value="${escapeHtml(val)}" placeholder="${isRsl ? '-37.9 dBm' : 'OK / NA'}"
                oninput="window.app.setRadioTestPortValue(${test.no}, ${jsArg(port.label)}, this.value)"
                style="flex: 1; text-align: left; padding: 6px 10px; font-weight: 600;">
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                ${chipsHtml}
              </div>
            </div>
          </div>
        `;
      });

      cardsHtml += `
        <div class="radio-test-card" style="margin-bottom: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 12px; background: var(--bg-surface-raised);">
          <div class="radio-test-card-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div class="radio-test-title" style="font-size: 14px; font-weight: 700; color: #fff;">NO. ${test.no} - ${escapeHtml(test.item)}</div>
              <div class="radio-test-meta" style="margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap;">
                <span class="badge badge-outline" style="font-size: 11px;">📋 ${escapeHtml(test.spec || 'Satisfactory')}</span>
                <span class="badge badge-accent" style="font-size: 11px;">🛠 ${escapeHtml(test.equipment || 'Monitoring')}</span>
              </div>
            </div>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="btn btn-sm btn-success" style="padding: 3px 8px; min-height: 26px; font-size: 11px;"
                onclick="window.app.setAllPortsForTest(${test.no}, 'OK')">All OK</button>
              <button type="button" class="btn btn-sm btn-secondary" style="padding: 3px 8px; min-height: 26px; font-size: 11px;"
                onclick="window.app.setAllPortsForTest(${test.no}, 'NA')">All NA</button>
            </div>
          </div>
          <div>${portsHtml}</div>
        </div>
      `;
    });
    cardsCont.innerHTML = cardsHtml;

    // 3. Render Table Mode (matching the Nokia Excel spreadsheet format)
    if (tableCont) {
      let thPorts = '';
      portCols.forEach(p => {
        thPorts += `<th>${escapeHtml(p.label)}</th>`;
      });

      let tbodyRows = '';
      tests.forEach(test => {
        const testMap = this.formData.radio.tests[test.no] || {};
        let tdPorts = '';
        portCols.forEach(port => {
          const val = testMap[port.label] !== undefined ? testMap[port.label] : (test.ports?.[port.label]?.value || '');
          const safePortId = port.label.replace(/[^a-zA-Z0-9]/g, '_');
          tdPorts += `
            <td style="text-align: center;">
              <input type="text" class="radio-cell-input" id="radio_tbl_${test.no}_${safePortId}"
                value="${escapeHtml(val)}"
                oninput="window.app.setRadioTestPortValue(${test.no}, ${jsArg(port.label)}, this.value)">
            </td>
          `;
        });

        tbodyRows += `
          <tr>
            <td style="text-align: center; font-weight: 700; color: var(--accent);">${test.no}</td>
            <td style="font-weight: 600; min-width: 130px;">${escapeHtml(test.item)}</td>
            <td style="color: var(--text-muted); font-size: 11px; max-width: 220px; white-space: normal;">${escapeHtml(test.spec || '')}</td>
            <td style="color: var(--text-muted); font-size: 11px; min-width: 110px;">${escapeHtml(test.equipment || '')}</td>
            ${tdPorts}
          </tr>
        `;
      });

      tableCont.innerHTML = `
        <table class="radio-matrix-table">
          <thead>
            <tr>
              <th style="width: 40px;">NO.</th>
              <th>Test Item</th>
              <th>Specification</th>
              <th>Test Equipment</th>
              ${thPorts}
            </tr>
          </thead>
          <tbody>
            ${tbodyRows}
          </tbody>
        </table>
      `;
    }
  }

  // ==========================================
  // SECTION 6: Saisie Terrain / Checklist Guidée
  // ==========================================
  buildWizardItemsList() {
    this.wizardItemsList = [];
    if (!this.currentStructure) return;

    // 1. Gather all Geotag items
    this.currentStructure.sheets
      .filter(s => s.type === 'GEOTAG_PHOTO_REPORT' && !s.hidden)
      .forEach(sheet => {
        sheet.content.items?.forEach(item => {
          this.wizardItemsList.push({
            type: 'geotag',
            sheetName: sheet.name,
            id: item.id,
            itemNo: item.itemNo,
            title: item.description,
            group: 'Geotag Photo',
            slots: item.slots || []
          });
        });
      });

    // 2. Gather all Inspection items
    this.currentStructure.sheets
      .filter(s => s.type === 'PHYSICAL_INSPECTION' && !s.hidden)
      .forEach(sheet => {
        sheet.content.items?.forEach((item, idx) => {
          this.wizardItemsList.push({
            type: 'inspection',
            sheetName: sheet.name,
            id: item.id,
            itemNo: idx + 1,
            title: item.item,
            group: item.group,
            detail: item.detail || '',
            comment: item.comment || ''
          });
        });
      });

    // Populate dropdown
    const selector = document.getElementById('wizardItemSelector');
    if (selector) {
      selector.innerHTML = '';
      this.wizardItemsList.forEach((it, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${it.type === 'geotag' ? '📷' : '📋'} #${it.itemNo} ${it.title}`;
        selector.appendChild(opt);
      });
      selector.value = this.currentWizardIndex;
      selector.onchange = (e) => {
        this.currentWizardIndex = parseInt(e.target.value, 10);
        this.renderWizardActiveItem();
      };
    }
  }

  renderWizardActiveItem() {
    const container = document.getElementById('wizardActiveItemCard');
    if (!container) return;

    if (this.wizardItemsList.length === 0) {
      container.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">Please load or import an Excel template to start the checklist.</div>';
      return;
    }

    if (this.currentWizardIndex < 0) this.currentWizardIndex = 0;
    if (this.currentWizardIndex >= this.wizardItemsList.length) this.currentWizardIndex = this.wizardItemsList.length - 1;

    const total = this.wizardItemsList.length;
    const current = this.currentWizardIndex + 1;
    const progressPercent = Math.round((current / total) * 100);

    document.getElementById('wizardGlobalProgressBadge').textContent = `Item ${current} / ${total}`;
    document.getElementById('wizardProgressBar').style.width = `${progressPercent}%`;

    const selector = document.getElementById('wizardItemSelector');
    if (selector && selector.value != this.currentWizardIndex) {
      selector.value = this.currentWizardIndex;
    }

    const item = this.wizardItemsList[this.currentWizardIndex];

    if (item.type === 'geotag') {
      let slotsHtml = '';
      item.slots.forEach((s) => {
        const slotKey = `${item.id}_s${s.slotIndex}`;
        const photoData = this.formData.geotags[slotKey];

        slotsHtml += `
          <div class="photo-slot-card" style="margin-top: 10px;">
            <div class="photo-slot-header">
              <div class="photo-slot-instruction">📌 Slot ${s.slotIndex + 1}: ${s.instruction}</div>
              <span class="badge ${photoData ? 'badge-success' : 'badge-outline'}">${photoData ? 'Captured' : 'Empty'}</span>
            </div>
            <div class="photo-preview-box">
              ${photoData ? `<img src="${photoData}" alt="Captured">` : `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-muted);">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">No photo captured</div>
              `}
            </div>
            <div class="photo-actions">
              <button class="btn btn-sm btn-primary" onclick="window.app.triggerPhotoCapture(${jsArg(slotKey)}, 'geotag', ${jsArg(item.title + ': ' + s.instruction)}, 'camera')">
                Camera
              </button>
              <button class="btn btn-sm btn-secondary" onclick="window.app.triggerPhotoCapture(${jsArg(slotKey)}, 'geotag', ${jsArg(item.title + ': ' + s.instruction)}, 'gallery')">
                Gallery
              </button>
              ${photoData ? `
                <button class="btn btn-sm btn-outline" style="color: var(--danger);" onclick="window.app.removePhoto(${jsArg(slotKey)})">
                  Remove
                </button>
              ` : ''}
            </div>
          </div>
        `;
      });

      container.innerHTML = `
        <div class="card-header" style="margin-bottom: 8px;">
          <div>
            <span class="badge badge-accent">GEOTAG PHOTO</span>
            <div class="card-title" style="margin-top: 4px;">#${item.itemNo} ${item.title}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${item.sheetName}</div>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          ${slotsHtml}
        </div>

        <div class="wizard-nav-bar">
          <button class="btn btn-secondary btn-full" ${this.currentWizardIndex === 0 ? 'disabled' : ''} onclick="window.app.stepWizard(-1)">
            ◀ Previous
          </button>
          <button class="btn btn-primary btn-full" ${this.currentWizardIndex === this.wizardItemsList.length - 1 ? 'disabled' : ''} onclick="window.app.stepWizard(1)">
            Next ▶
          </button>
        </div>
      `;
    } else {
      // Physical inspection item
      const entry = this.formData.inspections[item.id] || {
        status: 'OK',
        detail: item.detail || '',
        comment: item.comment || ''
      };
      this.formData.inspections[item.id] = entry;

      container.innerHTML = `
        <div class="card-header" style="margin-bottom: 8px;">
          <div>
            <span class="badge badge-outline">${item.group || 'Physical Inspection'}</span>
            <div class="card-title" style="margin-top: 4px;">#${item.itemNo} ${item.title}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${item.sheetName}</div>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <label>Status (OK by default, NOT OK requires comment)</label>
          <div class="status-btn-group">
            <button class="status-btn ${entry.status === 'OK' ? 'active-ok' : ''}" onclick="window.app.setWizardItemStatus('${item.id}', 'OK')">✓ OK</button>
            <button class="status-btn ${entry.status === 'NA' ? 'active-na' : ''}" onclick="window.app.setWizardItemStatus('${item.id}', 'NA')">NA</button>
            <button class="status-btn ${entry.status === 'NOT OK' ? 'active-notok' : ''}" onclick="window.app.promptNotOkWithMandatoryComment('${item.id}')">✗ NOT OK</button>
          </div>
        </div>

        <div class="form-group">
          <label>Detail / Specification (e.g. S/N, cable size, height)</label>
          <input type="text" id="wizDetailInput" value="${escapeHtml(entry.detail || '')}" placeholder="Enter specific measurement or value...">
        </div>

        <div class="form-group">
          <label>Comment / Observation ${entry.status === 'NOT OK' ? '<span style="color:var(--danger)">* MANDATORY</span>' : ''}</label>
          <input type="text" id="wizCommentInput" value="${escapeHtml(entry.comment || '')}" placeholder="Comment...">
        </div>

        <div class="wizard-nav-bar">
          <button class="btn btn-secondary btn-full" ${this.currentWizardIndex === 0 ? 'disabled' : ''} onclick="window.app.stepWizard(-1)">
            ◀ Previous
          </button>
          <button class="btn btn-primary btn-full" ${this.currentWizardIndex === this.wizardItemsList.length - 1 ? 'disabled' : ''} onclick="window.app.stepWizard(1)">
            Next ▶
          </button>
        </div>
      `;

      document.getElementById('wizDetailInput')?.addEventListener('input', (e) => {
        this.formData.inspections[item.id].detail = e.target.value;
        this.autoSave();
      });
      document.getElementById('wizCommentInput')?.addEventListener('input', (e) => {
        this.formData.inspections[item.id].comment = e.target.value;
        this.autoSave();
      });
    }
  }

  stepWizard(dir) {
    this.currentWizardIndex += dir;
    this.renderWizardActiveItem();
    window.scrollTo({ top: 100, behavior: 'smooth' });
    this.vibrate(25);
  }

  setWizardItemStatus(itemId, status) {
    if (!this.formData.inspections[itemId]) {
      this.formData.inspections[itemId] = { status: status, detail: '', comment: '' };
    } else {
      this.formData.inspections[itemId].status = status;
    }
    this.renderWizardActiveItem();
    this.autoSave();
    this.vibrate(30);
  }

  promptNotOkWithMandatoryComment(itemId) {
    this.pendingNotOkTarget = itemId;
    document.getElementById('mandatoryCommentText').value = this.formData.inspections[itemId]?.comment || '';
    document.getElementById('mandatoryCommentModal').classList.add('active');
  }

  confirmMandatoryComment() {
    const comment = document.getElementById('mandatoryCommentText').value.trim();
    if (!comment) {
      alert('A comment explaining the defect is mandatory when NOT OK is selected.');
      return;
    }

    if (this.pendingNotOkTarget) {
      if (!this.formData.inspections[this.pendingNotOkTarget]) {
        this.formData.inspections[this.pendingNotOkTarget] = { status: 'NOT OK', detail: '', comment };
      } else {
        this.formData.inspections[this.pendingNotOkTarget].status = 'NOT OK';
        this.formData.inspections[this.pendingNotOkTarget].comment = comment;
      }
    }

    document.getElementById('mandatoryCommentModal').classList.remove('active');
    this.pendingNotOkTarget = null;
    this.renderWizardActiveItem();
    this.autoSave();
    this.showToast('Marked NOT OK with comment');
  }

  // Copy recurring parameters from previous PM of same site
  async copyFromPreviousPM() {
    const currentSite = this.formData.common.siteName.trim().toLowerCase();
    if (!currentSite) {
      alert('Please enter a Site Name first to find previous PMs.');
      return;
    }

    const reports = await window.pmDB.listReports();
    const prev = reports.find(r => r.siteName && r.siteName.trim().toLowerCase() === currentSite && r.id !== this.currentReportId);

    if (!prev || !prev.formData) {
      alert(`No previous PM found for site "${this.formData.common.siteName}". First PM for this site.`);
      return;
    }

    // Copy recurring technical specifications
    const prevCommon = prev.formData.common || {};
    if (prevCommon.siteLong && !this.formData.common.siteLong) this.formData.common.siteLong = prevCommon.siteLong;
    if (prevCommon.siteLat && !this.formData.common.siteLat) this.formData.common.siteLat = prevCommon.siteLat;
    if (prevCommon.hopName && !this.formData.common.hopName) this.formData.common.hopName = prevCommon.hopName;

    // Copy hardware inspection details
    const prevInspections = prev.formData.inspections || {};
    let copiedCount = 0;
    for (const [key, val] of Object.entries(prevInspections)) {
      if (val.detail && this.formData.inspections[key]) {
        this.formData.inspections[key].detail = val.detail;
        copiedCount++;
      }
    }

    this.applyFormDataToInputs();
    this.renderAllViews();
    this.autoSave();
    this.showToast(`Copied ${copiedCount} hardware specs from previous PM (${prev.date})`);
    this.vibrate(60);
  }

  // -------------------------------------------------------------
  // Point 2: Trigger photo capture:
  // - Camera: launches default camera (e.g. TimeStamp Camera) via input without multiple
  // - Gallery: opens gallery via input with multiple
  // -------------------------------------------------------------
  triggerPhotoCapture(slotKey, type, label, source) {
    this.currentPhotoSlotTarget = { slotKey, type, label };
    if (source === 'camera') {
      const cameraInput = document.getElementById('photoCameraInput');
      cameraInput.value = "";
      cameraInput.click();
    } else {
      const galleryInput = document.getElementById('photoGalleryInput');
      galleryInput.value = "";
      galleryInput.click();
    }
  }

  // -------------------------------------------------------------
  // Point 3: Process camera photo:
  // - No application watermark overlay
  // - No GPS query during photo taking
  // - Corrects EXIF orientation, resized to max 1600px with 0.85 quality
  // -------------------------------------------------------------
  async handleCameraFileSelected(file) {
    if (!file || !this.currentPhotoSlotTarget) return;

    if (file.size > 15 * 1024 * 1024) {
      alert("Photo trop volumineuse (> 15 Mo). Veuillez réduire la résolution de l'appareil.");
      return;
    }

    this.showToast('Traitement de la photo...');
    try {
      const processed = await window.geotagService.processPhotoFile(file, 1600, 0.85);

      const target = this.currentPhotoSlotTarget;
      if (target.type === 'geotag') {
        this.formData.geotags[target.slotKey] = processed.base64;
        this.renderGeotagSheets();
        this.renderWizardActiveItem();
        this.updateGeotagProgress();
      } else if (target.type === 'free_cell') {
        const parts = target.slotKey.split('_');
        const sheet = parts[1];
        const r = parts[2];
        const c = parts[3];
        if (!this.formData.freeGridEdits[sheet]) this.formData.freeGridEdits[sheet] = {};
        this.formData.freeGridEdits[sheet][`${r}_${c}`] = processed.base64;
        this.renderFreeModeGrid();
      }

      this.currentPhotoSlotTarget = null;
      this.autoSave();
      this.showToast('Photo enregistrée !');
      this.vibrate(35);
    } catch (err) {
      console.error('Error processing camera photo:', err);
      alert('Erreur lors du traitement de la photo : ' + err.message);
    }
  }

  // -------------------------------------------------------------
  // Point 2: Process gallery multiple photos:
  // Assigns photos in order to the free slots of the current item,
  // then proposes to proceed to the next item
  // -------------------------------------------------------------
  async handleGalleryFilesSelected(fileList) {
    if (!fileList || fileList.length === 0 || !this.currentPhotoSlotTarget) return;

    const files = Array.from(fileList);
    const target = this.currentPhotoSlotTarget;
    const currentSlotKey = target.slotKey;

    // Find parent item definition if this is a Geotag item
    let parentItem = null;
    if (this.currentStructure && target.type === 'geotag') {
      for (const sheet of this.currentStructure.sheets) {
        if (sheet.type === 'GEOTAG_PHOTO_REPORT' && sheet.content?.items) {
          const it = sheet.content.items.find(x => x.slots && x.slots.some(s => `${x.id}_s${s.slotIndex}` === currentSlotKey));
          if (it) {
            parentItem = it;
            break;
          }
        }
      }
    }

    this.showToast(`Traitement de ${files.length} photo(s)...`);

    // Determine target slots in order
    const slotsToAssign = [];
    if (parentItem && parentItem.slots) {
      const currentSlotIdx = parentItem.slots.findIndex(s => `${parentItem.id}_s${s.slotIndex}` === currentSlotKey);
      const startIdx = currentSlotIdx >= 0 ? currentSlotIdx : 0;

      // First, slots from clicked slot onwards
      for (let i = startIdx; i < parentItem.slots.length; i++) {
        slotsToAssign.push(`${parentItem.id}_s${parentItem.slots[i].slotIndex}`);
      }
      // Then wrap to earlier slots if any
      for (let i = 0; i < startIdx; i++) {
        const k = `${parentItem.id}_s${parentItem.slots[i].slotIndex}`;
        if (!slotsToAssign.includes(k)) {
          slotsToAssign.push(k);
        }
      }
    } else {
      slotsToAssign.push(currentSlotKey);
    }

    let assignedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 15 * 1024 * 1024) continue;
      try {
        const processed = await window.geotagService.processPhotoFile(file, 1600, 0.85);
        const slotKey = slotsToAssign[i] || (parentItem ? `${parentItem.id}_s${i}` : currentSlotKey);
        this.formData.geotags[slotKey] = processed.base64;
        assignedCount++;
      } catch (err) {
        console.warn('Error processing gallery photo:', err);
      }
    }

    this.renderGeotagSheets();
    this.renderWizardActiveItem();
    this.updateGeotagProgress();
    this.autoSave();
    this.vibrate(40);

    if (assignedCount > 0) {
      this.showToast(`${assignedCount} photo(s) affectée(s) avec succès`);
      // Point 2: Propose to proceed to the next item
      setTimeout(() => {
        if (confirm(`${assignedCount} photo(s) affectée(s) à cet item. Souhaitez-vous passer à l'item suivant ?`)) {
          this.stepWizard(1);
        }
      }, 300);
    }
  }

  removePhoto(slotKey) {
    delete this.formData.geotags[slotKey];
    this.renderGeotagSheets();
    this.renderWizardActiveItem();
    this.updateGeotagProgress();
    this.autoSave();
  }

  // ==========================================
  // SECTION 4: Structure du Template
  // ==========================================
  renderStructureEditor() {
    const select = document.getElementById('structureSheetSelect');
    if (!select || !this.currentStructure) return;

    select.innerHTML = '';
    this.currentStructure.sheets.forEach((sheet) => {
      const opt = document.createElement('option');
      opt.value = sheet.name;
      opt.textContent = `${sheet.name} (${sheet.type}) ${sheet.hidden ? '[HIDDEN]' : ''}`;
      select.appendChild(opt);
    });

    const activeSheetName = select.value;
    this.renderStructureItemsForSheet(activeSheetName);

    select.onchange = () => {
      this.renderStructureItemsForSheet(select.value);
    };
  }

  renderStructureItemsForSheet(sheetName) {
    const container = document.getElementById('structureItemsList');
    container.innerHTML = '';

    const sheet = this.currentStructure?.sheets.find(s => s.name === sheetName);
    if (!sheet) return;

    // Sheet toolbar actions: Hide / Show / Delete
    const sheetBar = document.createElement('div');
    sheetBar.style.display = 'flex';
    sheetBar.style.gap = '8px';
    sheetBar.style.marginBottom = '12px';
    sheetBar.innerHTML = `
      <button class="btn btn-sm btn-secondary" id="btnToggleHideSheet">
        ${sheet.hidden ? 'Show Sheet' : 'Hide Sheet'}
      </button>
      <button class="btn btn-sm btn-outline" style="color: var(--danger); border-color: var(--danger);" id="btnDeleteSheet">
        Delete Sheet
      </button>
    `;
    sheetBar.querySelector('#btnToggleHideSheet').onclick = () => {
      sheet.hidden = !sheet.hidden;
      window.excelTemplateAnalyzer.recalculateItemNumbers(this.currentStructure);
      this.renderStructureEditor();
      this.autoSave();
    };
    sheetBar.querySelector('#btnDeleteSheet').onclick = () => {
      if (confirm(`Are you sure you want to delete sheet "${sheet.name}"?`)) {
        this.currentStructure.sheets = this.currentStructure.sheets.filter(s => s.name !== sheet.name);
        window.excelTemplateAnalyzer.recalculateItemNumbers(this.currentStructure);
        this.renderAllViews();
        this.autoSave();
      }
    };
    container.appendChild(sheetBar);

    // List items
    const items = sheet.content?.items || [];
    if (items.length === 0) {
      container.innerHTML += '<div style="color: var(--text-muted); font-size: 13px;">No items in this sheet.</div>';
      return;
    }

    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'structure-item-row';

      const title = it.description || it.item || `Item ${idx + 1}`;
      const itemNumber = it.itemNo || idx + 1;

      row.innerHTML = `
        <div style="flex: 1; overflow: hidden; text-overflow: ellipsis;">
          <div style="font-weight: 700; font-size: 13px; color: #fff;">#${itemNumber} ${title}</div>
          <div style="font-size: 11px; color: var(--text-muted);">
            ${sheet.type === 'GEOTAG_PHOTO_REPORT' ? `${it.slots?.length || 0} photo slots` : (it.group || 'General')}
          </div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="structure-action-btn btn-move-up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="structure-action-btn btn-move-down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
          ${sheet.type === 'GEOTAG_PHOTO_REPORT' ? `<button class="structure-action-btn btn-add-slot">+Slot</button>` : ''}
          <button class="structure-action-btn btn-rename">Rename</button>
          <button class="structure-action-btn btn-delete" style="color: var(--danger);">✕</button>
        </div>
      `;

      row.querySelector('.btn-move-up').onclick = () => {
        window.excelTemplateAnalyzer.reorderItem(this.currentStructure, sheetName, it.id, 'up');
        this.renderStructureItemsForSheet(sheetName);
        this.autoSave();
      };
      row.querySelector('.btn-move-down').onclick = () => {
        window.excelTemplateAnalyzer.reorderItem(this.currentStructure, sheetName, it.id, 'down');
        this.renderStructureItemsForSheet(sheetName);
        this.autoSave();
      };
      row.querySelector('.btn-rename').onclick = () => {
        const newTitle = prompt('Rename item:', title);
        if (newTitle) {
          if (it.description !== undefined) it.description = newTitle;
          if (it.item !== undefined) it.item = newTitle;
          this.renderStructureItemsForSheet(sheetName);
          this.autoSave();
        }
      };
      row.querySelector('.btn-delete').onclick = () => {
        sheet.content.items = sheet.content.items.filter(x => x.id !== it.id);
        window.excelTemplateAnalyzer.recalculateItemNumbers(this.currentStructure);
        this.renderStructureItemsForSheet(sheetName);
        this.autoSave();
      };

      const addSlotBtn = row.querySelector('.btn-add-slot');
      if (addSlotBtn) {
        addSlotBtn.onclick = () => {
          const instruction = prompt('Photo instruction for new slot:', 'Detailed view');
          if (instruction) {
            window.excelTemplateAnalyzer.addPhotoSlotToItem(this.currentStructure, sheetName, it.id, instruction);
            this.renderStructureItemsForSheet(sheetName);
            this.autoSave();
            this.showToast('Added photo slot (with continuation if > 4)');
          }
        };
      }

      container.appendChild(row);
    });
  }

  openDuplicateSheetModal() {
    const select = document.getElementById('dupSourceSheetSelect');
    select.innerHTML = '';
    this.currentStructure?.sheets.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = `${s.name} (${s.type})`;
      select.appendChild(opt);
    });

    const active = select.value;
    document.getElementById('dupNewSheetNameInput').value = `${active} (Copy)`;
    document.getElementById('duplicateSheetModal').classList.add('active');
  }

  confirmDuplicateSheet() {
    const sourceSheet = document.getElementById('dupSourceSheetSelect').value;
    const newName = document.getElementById('dupNewSheetNameInput').value.trim();

    if (!newName) {
      alert('Please enter a sheet name');
      return;
    }

    try {
      window.excelTemplateAnalyzer.duplicateSheet(this.currentStructure, sourceSheet, newName);
      document.getElementById('duplicateSheetModal').classList.remove('active');
      this.renderAllViews();
      this.autoSave();
      this.showToast(`Duplicated sheet as "${newName}"`);
    } catch (e) {
      alert('Failed to duplicate sheet: ' + e.message);
    }
  }

  // ==========================================
  // SECTION 5: Mode Libre (secours)
  // ==========================================
  renderFreeModeGrid() {
    const select = document.getElementById('freeModeSheetSelect');
    if (!select || !this.currentStructure) return;

    if (select.children.length === 0) {
      this.currentStructure.sheets.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = `${s.name} (${s.type})`;
        select.appendChild(opt);
      });
    }

    const sheetName = select.value;
    const sheet = this.currentStructure.sheets.find(s => s.name === sheetName);
    const container = document.getElementById('freeModeGridContainer');
    container.innerHTML = '';

    if (!sheet || !sheet.rawGrid || sheet.rawGrid.length === 0) {
      container.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">No cell data available for this sheet.</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'excel-grid-table';

    // Header row with Column letters
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th>Row</th>';
    for (let c = 1; c <= 12; c++) {
      const colLetter = String.fromCharCode(64 + c);
      headRow.innerHTML += `<th>${colLetter}</th>`;
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    const sheetEdits = this.formData.freeGridEdits[sheetName] || {};

    sheet.rawGrid.slice(0, 50).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th>${r.row}</th>`;

      for (let c = 1; c <= 12; c++) {
        const cellData = r.cells.find(x => x.col === c);
        const cellKey = `${r.row}_${c}`;
        const editedVal = sheetEdits[cellKey];
        const displayVal = editedVal !== undefined ? editedVal : (cellData?.value || '');
        const isPhoto = typeof displayVal === 'string' && displayVal.startsWith('data:image');

        const td = document.createElement('td');
        if (editedVal !== undefined) td.classList.add('has-edit');

        if (isPhoto) {
          td.innerHTML = '<span style="color: var(--accent); font-weight:700;">📷 [IMAGE]</span>';
        } else {
          td.textContent = displayVal;
        }

        td.onclick = () => {
          this.openFreeCellModal(sheetName, r.row, c, displayVal);
        };
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  openFreeCellModal(sheetName, row, col, currentValue) {
    this.currentFreeCell = { sheetName, row, col };
    const colLetter = String.fromCharCode(64 + col);
    document.getElementById('freeCellModalTitle').textContent = `Cell ${colLetter}${row} (${sheetName})`;
    document.getElementById('freeCellTextInput').value = currentValue.startsWith('data:image') ? '[IMAGE]' : currentValue;
    document.getElementById('freeCellModal').classList.add('active');
  }

  saveFreeCell() {
    if (!this.currentFreeCell) return;
    const { sheetName, row, col } = this.currentFreeCell;
    const newVal = document.getElementById('freeCellTextInput').value;

    if (!this.formData.freeGridEdits[sheetName]) {
      this.formData.freeGridEdits[sheetName] = {};
    }
    this.formData.freeGridEdits[sheetName][`${row}_${col}`] = newVal;

    document.getElementById('freeCellModal').classList.remove('active');
    this.renderFreeModeGrid();
    this.autoSave();
    this.showToast('Cell updated');
  }

  insertPhotoInFreeCell() {
    if (!this.currentFreeCell) return;
    this.currentPhotoSlotTarget = {
      slotKey: `free_${this.currentFreeCell.sheetName}_${this.currentFreeCell.row}_${this.currentFreeCell.col}`,
      type: 'free_cell',
      label: `Cell R${this.currentFreeCell.row}C${this.currentFreeCell.col}`
    };
    document.getElementById('freeCellModal').classList.remove('active');
    document.getElementById('photoCameraInput').click();
  }
  // Ajoute l'onglet « Radio » sans modifier index.html
  injectRadioTab() {
    if (document.getElementById('tab-radio')) return;

    const refTab = document.querySelector('.nav-tab[data-tab="tab-free-grid"]') ||
                   document.querySelector('.nav-tab:last-child');
    if (refTab) {
      const btn = refTab.cloneNode(true);
      btn.setAttribute('data-tab', 'tab-radio');
      btn.classList.remove('active');
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      let node, renamed = false;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.trim()) { node.nodeValue = 'Radio'; renamed = true; break; }
      }
      if (!renamed) btn.appendChild(document.createTextNode('Radio'));
      refTab.after(btn);
    }

    const host = document.getElementById('tab-free-grid') || document.querySelector('.tab-content');
    if (host) {
      const sec = document.createElement(host.tagName);
      sec.id = 'tab-radio';
      sec.className = 'tab-content';
      sec.innerHTML = `
        <div class="card">
          <div class="card-header"><div class="card-title">Radio config &amp; Performance</div></div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
            Modifiez les valeurs de la feuille Radio config. Elles sont enregistrées automatiquement
            et écrites dans le fichier Excel à l'export.
          </div>
          <div id="radioEditorContainer"></div>
        </div>`;
      host.after(sec);
    }
  }

  renderRadioEditor() {
    const box = document.getElementById('radioEditorContainer');
    if (!box) return;
    box.innerHTML = '';
    const sheets = (this.currentStructure?.sheets || [])
      .filter(s => s.type === 'RADIO_CONFIG' && !s.hidden && s.content && s.content.editor);
    if (sheets.length === 0) {
      box.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Aucune feuille Radio config détectée. Importez (ou réimportez) le template du site.</div>';
      return;
    }
    sheets.forEach(sheet => this.renderRadioEditorSheet(box, sheet));
  }

  renderRadioEditorSheet(box, sheet) {
    const ed = sheet.content.editor;
    const name = sheet.name;
    const edits = () => this.formData.freeGridEdits[name] || {};
    const setEdit = (key, value) => {
      if (!this.formData.freeGridEdits[name]) this.formData.freeGridEdits[name] = {};
      this.formData.freeGridEdits[name][key] = value;
      this.autoSave();
    };
    const heading = (t) => {
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:700;font-size:14px;margin:16px 0 8px;color:#fff;';
      h.textContent = t;
      box.appendChild(h);
    };

    heading('Configuration système et fréquences');
    if (!ed.fields.length) {
      const p = document.createElement('div');
      p.style.cssText = 'color:var(--text-muted);font-size:13px;';
      p.textContent = 'Aucun champ détecté dans cette feuille.';
      box.appendChild(p);
    }

    ed.fields.forEach(f => {
      const key = `${f.row}_${f.col}`;
      const stored = edits()[key];
      let shown = f.value;
      if (stored !== undefined) {
        shown = String(stored);
        if (f.inline && f.prefix && shown.startsWith(f.prefix)) shown = shown.slice(f.prefix.length).trim();
      }
      const group = document.createElement('div');
      group.className = 'form-group';
      const label = document.createElement('label');
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = shown;
      input.addEventListener('input', () => {
        setEdit(key, f.inline ? `${f.prefix} ${input.value}`.trim() : input.value);
      });
      group.appendChild(label);
      group.appendChild(input);
      box.appendChild(group);
    });

    const tests = ed.tests || { ports: [], rows: [] };
    if (tests.rows.length) {
      heading('Tests par port ODU');
      const wrap = document.createElement('div');
      wrap.style.overflowX = 'auto';
      const table = document.createElement('table');
      table.className = 'excel-grid-table';

      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      ['N°', 'Test'].concat(tests.ports.map(p => p.label.replace(/odu\s*/i, ''))).forEach(t => {
        const th = document.createElement('th');
        th.textContent = t;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      tests.rows.forEach(row => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = row.no;
        tr.appendChild(th);
        const tdName = document.createElement('td');
        tdName.textContent = row.name;
        tr.appendChild(tdName);

        row.cells.forEach(cell => {
          const key = `${cell.row}_${cell.col}`;
          const stored = edits()[key];
          let last = stored !== undefined ? String(stored) : cell.value;

          const sel = document.createElement('select');
          const opts = ['', 'OK', 'NOT OK', 'NA'];
          if (last && !opts.includes(last)) opts.push(last);
          opts.push('✎ Autre…');
          opts.forEach(o => {
            const op = document.createElement('option');
            op.value = o;
            op.textContent = o === '' ? '—' : o;
            sel.appendChild(op);
          });
          sel.value = last;
          sel.addEventListener('change', () => {
            let v = sel.value;
            if (v === '✎ Autre…') {
              const typed = prompt('Valeur de la case :', last || '');
              if (typed === null) { sel.value = last; return; }
              v = typed.trim();
              if (v && ![...sel.options].some(o => o.value === v)) {
                const op = document.createElement('option');
                op.value = v;
                op.textContent = v;
                sel.insertBefore(op, sel.lastChild);
              }
              sel.value = v;
            }
            last = v;
            setEdit(key, v);
          });

          const td = document.createElement('td');
          td.appendChild(sel);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      box.appendChild(wrap);
    }
  }
  // ==========================================
  // SECTION 6: Tactile Signature Pads
  // ==========================================
  setupSignaturePads() {
    this.initCanvasPad('sigCanvasFoe', 'foeSig');
    this.initCanvasPad('sigCanvasExpert', 'expertSig');
    this.initCanvasPad('sigCanvasAirtel', 'airtelSig');

    document.getElementById('btnClearSigFoe')?.addEventListener('click', () => this.clearCanvas('sigCanvasFoe'));
    document.getElementById('btnClearSigExpert')?.addEventListener('click', () => this.clearCanvas('sigCanvasExpert'));
    document.getElementById('btnClearSigAirtel')?.addEventListener('click', () => this.clearCanvas('sigCanvasAirtel'));

    document.getElementById('btnSaveSigFoe')?.addEventListener('click', () => this.saveCanvasSignature('sigCanvasFoe', 'foeSig', 'FOE'));
    document.getElementById('btnSaveSigExpert')?.addEventListener('click', () => this.saveCanvasSignature('sigCanvasExpert', 'expertSig', 'Expert'));
    document.getElementById('btnSaveSigAirtel')?.addEventListener('click', () => this.saveCanvasSignature('sigCanvasAirtel', 'airtelSig', 'Airtel'));
  }

  initCanvasPad(canvasId, storageKey) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth || 340;
    canvas.height = 150;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#002060';

    let drawing = false;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e) => {
      drawing = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      e.preventDefault();
    };

    const draw = (e) => {
      if (!drawing) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      e.preventDefault();
    };

    const stopDraw = () => {
      drawing = false;
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);

    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);
  }

  clearCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
  }

  saveCanvasSignature(canvasId, storageKey, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const base64Png = canvas.toDataURL('image/png');
    this.formData.signatures[storageKey] = base64Png;
    this.autoSave();
    this.showToast(`${label} signature saved and ready for report`);
    this.vibrate(50);
  }

  // ==========================================
  // Standard Inspection & Geotag Rendering
  // ==========================================
  renderInspectionSheets() {
    const tabsContainer = document.getElementById('inspectionSheetTabs');
    tabsContainer.innerHTML = '';

    const inspSheets = this.currentStructure?.sheets.filter(s => s.type === 'PHYSICAL_INSPECTION' && !s.hidden) || [];
    if (inspSheets.length === 0) {
      document.getElementById('inspectionItemsList').innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">No physical inspection sheets detected in workbook.</div>';
      return;
    }

    if (!this.activeInspectionSheet || !inspSheets.some(s => s.name === this.activeInspectionSheet)) {
      this.activeInspectionSheet = inspSheets[0].name;
    }

    inspSheets.forEach(s => {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${s.name === this.activeInspectionSheet ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = s.name.replace(/^physical\s*inspection\s*/i, '');
      btn.addEventListener('click', () => {
        this.activeInspectionSheet = s.name;
        this.activeInspectionFilter = 'ALL';
        this.renderInspectionSheets();
      });
      tabsContainer.appendChild(btn);
    });

    const activeSheetDef = inspSheets.find(s => s.name === this.activeInspectionSheet);
    if (!activeSheetDef) return;

    const filterContainer = document.getElementById('inspectionGroupFilters');
    filterContainer.innerHTML = '';

    const allPill = document.createElement('button');
    allPill.className = `btn btn-sm ${this.activeInspectionFilter === 'ALL' ? 'btn-accent' : 'btn-secondary'}`;
    allPill.textContent = 'All Groups';
    allPill.addEventListener('click', () => {
      this.activeInspectionFilter = 'ALL';
      this.renderInspectionItems(activeSheetDef);
    });
    filterContainer.appendChild(allPill);

    activeSheetDef.content.groups.forEach(grp => {
      const pill = document.createElement('button');
      pill.className = `btn btn-sm ${this.activeInspectionFilter === grp ? 'btn-accent' : 'btn-secondary'}`;
      pill.textContent = grp;
      pill.addEventListener('click', () => {
        this.activeInspectionFilter = grp;
        this.renderInspectionItems(activeSheetDef);
      });
      filterContainer.appendChild(pill);
    });

    this.renderInspectionItems(activeSheetDef);
  }

  renderInspectionItems(sheetDef) {
    const list = document.getElementById('inspectionItemsList');
    list.innerHTML = '';

    const items = sheetDef.content.items || [];
    const filtered = this.activeInspectionFilter === 'ALL'
      ? items
      : items.filter(it => it.group === this.activeInspectionFilter);

    if (filtered.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">No items in this group.</div>';
      return;
    }

    filtered.forEach(it => {
      const entry = this.formData.inspections[it.id] || {
        status: it.status || 'OK',
        detail: it.detail || '',
        comment: it.comment || ''
      };
      this.formData.inspections[it.id] = entry;

      const card = document.createElement('div');
      card.className = 'inspection-card';
      card.innerHTML = `
        <div class="inspection-header">
          <div class="inspection-name">${it.item}</div>
          <span class="inspection-group-tag">${it.group}</span>
        </div>

        <div class="status-btn-group">
          <button class="status-btn ${entry.status === 'OK' ? 'active-ok' : ''}" data-item-id="${it.id}" data-status="OK">✓ OK</button>
          <button class="status-btn ${entry.status === 'NA' ? 'active-na' : ''}" data-item-id="${it.id}" data-status="NA">N/A</button>
          <button class="status-btn ${entry.status === 'NOT OK' ? 'active-notok' : ''}" data-item-id="${it.id}" data-status="NOT OK">✗ NOT OK</button>
        </div>

        <div class="form-row">
          <div class="form-group" style="margin-bottom: 0;">
            <input type="text" class="insp-detail-input" data-item-id="${it.id}" placeholder="Detail / Specification" value="${entry.detail || ''}">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <input type="text" class="insp-comment-input" data-item-id="${it.id}" placeholder="Comment" value="${entry.comment || ''}">
          </div>
        </div>
      `;

      card.querySelectorAll('.status-btn').forEach(sBtn => {
        sBtn.addEventListener('click', (e) => {
          const status = e.target.dataset.status;
          const itemId = e.target.dataset.itemId;
          if (status === 'NOT OK') {
            this.promptNotOkWithMandatoryComment(itemId);
          } else {
            this.setWizardItemStatus(itemId, status);
            this.renderInspectionItems(sheetDef);
          }
        });
      });

      card.querySelector('.insp-detail-input').addEventListener('input', (e) => {
        this.formData.inspections[e.target.dataset.itemId].detail = e.target.value;
        this.autoSave();
      });
      card.querySelector('.insp-comment-input').addEventListener('input', (e) => {
        this.formData.inspections[e.target.dataset.itemId].comment = e.target.value;
        this.autoSave();
      });

      list.appendChild(card);
    });
  }

  setAllInspectionStatus(status) {
    const activeSheetDef = this.currentStructure?.sheets.find(s => s.name === this.activeInspectionSheet);
    if (!activeSheetDef) return;

    activeSheetDef.content.items.forEach(it => {
      if (!this.formData.inspections[it.id]) {
        this.formData.inspections[it.id] = { status: status, detail: it.detail || '', comment: it.comment || '' };
      } else {
        this.formData.inspections[it.id].status = status;
      }
    });

    this.renderInspectionItems(activeSheetDef);
    this.autoSave();
    this.showToast(`Set all items to ${status}`);
    this.vibrate(40);
  }

  renderGeotagSheets() {
    const tabsContainer = document.getElementById('geotagSheetTabs');
    tabsContainer.innerHTML = '';

    const geoSheets = this.currentStructure?.sheets.filter(s => s.type === 'GEOTAG_PHOTO_REPORT' && !s.hidden) || [];
    if (geoSheets.length === 0) {
      document.getElementById('geotagSlotsContainer').innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">No geotag photo sheets detected in workbook.</div>';
      return;
    }

    if (!this.activeGeotagSheet || !geoSheets.some(s => s.name === this.activeGeotagSheet)) {
      this.activeGeotagSheet = geoSheets[0].name;
    }

    geoSheets.forEach(s => {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${s.name === this.activeGeotagSheet ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = s.name.replace(/^geotag\s*photo\s*report\s*/i, 'Report ');
      btn.addEventListener('click', () => {
        this.activeGeotagSheet = s.name;
        this.renderGeotagSheets();
      });
      tabsContainer.appendChild(btn);
    });

    const activeSheetDef = geoSheets.find(s => s.name === this.activeGeotagSheet);
    if (!activeSheetDef) return;

    this.renderGeotagSlots(activeSheetDef);
  }

  renderGeotagSlots(sheetDef) {
    const container = document.getElementById('geotagSlotsContainer');
    container.innerHTML = '';

    const items = sheetDef.content.items || [];
    items.forEach(item => {
      (item.slots || []).forEach(slot => {
        const slotKey = `${item.id}_s${slot.slotIndex}`;
        const existingPhoto = this.formData.geotags[slotKey];
        const label = `${item.description}: ${slot.instruction}`;

        const card = document.createElement('div');
        card.className = 'photo-slot-card';
        card.innerHTML = `
          <div class="photo-slot-header">
            <div>
              <div class="photo-slot-title">#${item.itemNo} ${escapeHtml(item.description)}</div>
              <div class="photo-slot-instruction">📌 ${escapeHtml(slot.instruction)}</div>
            </div>
            <span class="badge ${existingPhoto ? 'badge-success' : 'badge-outline'}">${existingPhoto ? 'Captured' : 'Empty'}</span>
          </div>

          <div class="photo-preview-box">
            ${existingPhoto ? `<img src="${existingPhoto}" alt="Photo">` : `
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-muted);">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <div style="font-size: 11px; color: var(--text-muted);">No photo taken yet</div>
            `}
          </div>

          <div class="photo-actions">
            <button type="button" class="btn btn-sm btn-primary btn-slot-camera">Camera</button>
            <button type="button" class="btn btn-sm btn-secondary btn-slot-gallery">Gallery</button>
            ${existingPhoto ? `<button type="button" class="btn btn-sm btn-outline btn-slot-remove" style="color: var(--danger);">Remove</button>` : ''}
          </div>
        `;

        card.querySelector('.btn-slot-camera').addEventListener('click', () => {
          this.triggerPhotoCapture(slotKey, 'geotag', label, 'camera');
        });
        card.querySelector('.btn-slot-gallery').addEventListener('click', () => {
          this.triggerPhotoCapture(slotKey, 'geotag', label, 'gallery');
        });
        card.querySelector('.btn-slot-remove')?.addEventListener('click', () => {
          this.removePhoto(slotKey);
        });

        container.appendChild(card);
      });
    });
  }

  updateGeotagProgress() {
    const totalSlots = this.currentStructure?.summary.totalPhotoSlots || 0;
    const takenCount = Object.keys(this.formData.geotags).length;
    const badge = document.getElementById('geotagProgressBadge');
    if (badge) {
      badge.textContent = `${takenCount} / ${totalSlots} Done`;
      if (takenCount >= totalSlots && totalSlots > 0) {
        badge.className = 'badge badge-success';
      } else {
        badge.className = 'badge badge-accent';
      }
    }
  }

  // -------------------------------------------------------------
  // Point 3: GPS Acquisition strictly for Cover page
  // -------------------------------------------------------------
  async acquireGPS() {
    const statusText = document.getElementById('gpsStatusText');
    statusText.textContent = 'Acquiring GPS fix from device...';
    try {
      const pos = await window.geotagService.getPosition();
      const latDms = GeotagService.toDMS(pos.latitude, true);
      const lngDms = GeotagService.toDMS(pos.longitude, false);

      document.getElementById('inputSiteLong').value = lngDms;
      document.getElementById('inputSiteLat').value = latDms;

      this.formData.common.siteLong = lngDms;
      this.formData.common.siteLat = latDms;

      statusText.textContent = `✓ Fixed: Lat ${latDms}, Long ${lngDms} (Acc: ±${Math.round(pos.accuracy)}m)`;
      this.showToast('GPS position updated');
      this.autoSave();
      this.vibrate(60);
    } catch (err) {
      statusText.textContent = 'GPS failed: ' + err.message;
      alert('Could not retrieve GPS location: ' + err.message);
    }
  }

  // -------------------------------------------------------------
  // Point 1 & 4: Export Report with template check & photo fit mode
  // -------------------------------------------------------------
  async exportReport(shouldShare = true) {
    if (window.AndroidBridge && typeof window.AndroidBridge.isOperationAllowed === 'function') {
      if (!window.AndroidBridge.isOperationAllowed('export')) {
        if (window.openLicenseModal) window.openLicenseModal();
        return;
      }
    }

    // Si la visite comporte plusieurs link, proposer d'exporter tous les link
    if (this.currentVisit && Array.isArray(this.currentVisit.links) && this.currentVisit.links.length > 1) {
      const exportAll = confirm(`Cette visite comporte ${this.currentVisit.links.length} link.\n\nVoulez-vous exporter l'ensemble des ${this.currentVisit.links.length} link de la visite ?\n\n(Cliquez sur "Annuler" pour exporter uniquement le link actif)`);
      if (exportAll) {
        return this.exportVisit();
      }
    }

    // Point 1: L'erreur "please import an Excel Template" ne doit s'afficher
    // que si templateBuffer est null ou vide, jamais après un chargement réussi.
    if (!this.templateBuffer || this.templateBuffer.byteLength === 0) {
      alert("Please import an Excel Template");
      return;
    }

    if (!this.currentStructure) {
      alert("Please import an Excel Template");
      return;
    }

    // Check missing photos
    const missingPhotos = [];
    this.currentStructure.sheets
      .filter(s => s.type === 'GEOTAG_PHOTO_REPORT' && !s.hidden)
      .forEach(sheet => {
        sheet.content.items?.forEach(it => {
          it.slots?.forEach(slot => {
            const slotKey = `${it.id}_s${slot.slotIndex}`;
            if (!this.formData.geotags[slotKey]) {
              missingPhotos.push(`#${it.itemNo} ${it.description} (${slot.instruction})`);
            }
          });
        });
      });

    if (missingPhotos.length > 0) {
      const proceed = confirm(`Attention: ${missingPhotos.length} photo(s) are still missing:\n\n${missingPhotos.slice(0, 5).join('\n')}${missingPhotos.length > 5 ? '\n...and more' : ''}\n\nDo you want to proceed with export anyway?`);
      if (!proceed) return;
    }

    const keepInstruction = document.getElementById('chkKeepInstruction')?.checked || false;
    // Point 4: Choix du mode d'ajustement
    const photoFitMode = document.getElementById('selectPhotoFitMode')?.value || 'fit';

    this.showToast('Génération du fichier Excel avec photos et signatures...');

    try {
      const buffer = await window.excelExporter.generateReport(
        this.templateBuffer,
        this.currentStructure,
        this.formData,
        {
          keepInstructionText: keepInstruction,
          photoFitMode: photoFitMode
        }
      );

      const dateClean = (this.formData.common.date || new Date().toISOString().slice(0, 10)).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const equipment = this.getEquipmentName(this.formData, this.currentStructure);
      const fileName = `${this.buildReportBaseName(this.formData.common, equipment)}.xlsx`;

      window.excelExporter.downloadReport(buffer, fileName);

      // pmDB.saveReport SANS les photos (Règle 5)
      await window.pmDB.saveReport({
        id: this.currentReportId,
        siteName: this.formData.common.siteName || 'Site',
        date: dateClean,
        fileName: fileName,
        formData: this.stripPhotosFromFormData(this.formData),
        exportedAt: new Date().toISOString()
      });

      this.showToast('Fichier Excel généré avec succès !');
      this.vibrate(100);
      this.loadSavedReportsList();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Erreur lors de la génération du fichier Excel : ' + err.message);
    }
  }
  // Nom d'équipement : champ « Equipment » de la feuille Radio config (valeur saisie, sinon celle du template)
  getEquipmentName(formData, structure) {
    const cfgName = formData && formData.radio && formData.radio.configValues && formData.radio.configValues.equipment;
    if (cfgName && String(cfgName).trim()) return String(cfgName).trim();
    const sheet = ((structure && structure.sheets) || []).find(s => s.type === 'RADIO_CONFIG');
    let name = '';
    if (sheet && sheet.content && sheet.content.editor) {
      const f = (sheet.content.editor.fields || []).find(x => /equipment/i.test(x.label));
      if (f) {
        const edits = (formData && formData.freeGridEdits && formData.freeGridEdits[sheet.name]) || {};
        const stored = edits[`${f.row}_${f.col}`];
        name = stored !== undefined ? String(stored) : String(f.value || '');
        if (f.inline && f.prefix && name.startsWith(f.prefix)) name = name.slice(f.prefix.length);
      }
    }
    if (!name && formData && formData.radio && formData.radio.configValues) {
      name = formData.radio.configValues.equipment || '';
    }
    return String(name).trim();
  }

  // NOKIA PM Sheet Format_<équipement>_(<Site A>_to_<Site B>)
  buildReportBaseName(common, equipment, fallbackHop) {
    const FILE_PREFIX = 'NOKIA PM Sheet Format';
    const clean = (s) => String(s || '').trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[^\p{L}\p{N}_\-()]+/gu, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const a = clean(common.siteA || common.siteName);
    const b = clean(common.siteB);
    const eq = clean(equipment);
    const link = (a && b) ? `${a}_to_${b}` : (a || clean(common.hopName || fallbackHop || 'Hop'));
    return [FILE_PREFIX, eq, `(${link})`].filter(Boolean).join('_');
  }
  // Helper: Débarrasse le formData des images lourdes base64 pour saveReport (Règle 5)
  stripPhotosFromFormData(formData) {
    if (!formData) return {};
    const stripped = JSON.parse(JSON.stringify(formData));
    if (stripped.geotags && typeof stripped.geotags === 'object') {
      const lightGeotags = {};
      for (const [key, val] of Object.entries(stripped.geotags)) {
        if (val) {
          lightGeotags[key] = {
            captured: true,
            timestamp: val.timestamp || null,
            latitude: val.latitude || null,
            longitude: val.longitude || null,
            comment: val.comment || ''
          };
        }
      }
      stripped.geotags = lightGeotags;
    }
    if (stripped.monitoring && typeof stripped.monitoring === 'object') {
      for (const item of Object.values(stripped.monitoring)) {
        if (item && item.screenShootUrl) {
          item.screenShootUrl = '[captured]';
        }
      }
    }
    if (stripped.signatures && typeof stripped.signatures === 'object') {
      stripped.signatures = {
        foeName: stripped.signatures.foeName || '',
        foeContact: stripped.signatures.foeContact || '',
        expertName: stripped.signatures.expertName || '',
        airtelName: stripped.signatures.airtelName || '',
        hasFoeSig: !!stripped.signatures.foeSig,
        hasExpertSig: !!stripped.signatures.expertSig,
        hasAirtelSig: !!stripped.signatures.airtelSig
      };
    }
    return stripped;
  }

  // Helper: Conversion efficace d'un ArrayBuffer en Base64 sans saturation de pile
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 0x8000;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
  }

  // Gestion des indicateurs d'avancement de l'export séquentiel
  showExportProgress(current, total, detail) {
    const modal = document.getElementById('exportProgressModal');
    if (modal) modal.classList.add('active');
    this.updateExportProgress(current, total, detail);
  }

  updateExportProgress(current, total, detail) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const bar = document.getElementById('exportProgressBar');
    const count = document.getElementById('exportProgressCount');
    const detailEl = document.getElementById('exportProgressDetail');
    if (bar) bar.style.width = `${pct}%`;
    if (count) count.textContent = ` Link ${current} / ${total} (${pct}%)`;
    if (detailEl && detail) detailEl.textContent = detail;
  }

  hideExportProgress() {
    const modal = document.getElementById('exportProgressModal');
    if (modal) modal.classList.remove('active');
  }

  // Récapitulatif interactif des photos manquantes avant export (Règle 3)
  promptMissingPhotosConfirmation(missingByLink) {
    return new Promise((resolve) => {
      const modal = document.getElementById('exportRecapModal');
      const body = document.getElementById('exportRecapBody');
      const btnConfirm = document.getElementById('btnConfirmExportRecap');
      const btnCancel = document.getElementById('btnCancelExportRecap');
      const btnClose = document.getElementById('btnCloseExportRecap');

      if (!modal || !body || !btnConfirm || !btnCancel || !btnClose) {
        let msg = "Attention : Photos manquantes détectées :\n\n";
        missingByLink.forEach(m => {
          msg += `• [${m.linkName}] : ${m.count} photo(s) manquante(s)\n`;
          m.items.slice(0, 3).forEach(it => { msg += `    - ${it}\n`; });
          if (m.items.length > 3) msg += `    - ...et ${m.items.length - 3} autre(s)\n`;
        });
        msg += "\nVoulez-vous quand même lancer l'exportation des link ?";
        resolve(confirm(msg));
        return;
      }

      body.innerHTML = '';
      missingByLink.forEach(m => {
        const linkBlock = document.createElement('div');
        linkBlock.style.background = 'rgba(255, 179, 0, 0.08)';
        linkBlock.style.border = '1px solid rgba(255, 179, 0, 0.25)';
        linkBlock.style.borderRadius = 'var(--radius-sm)';
        linkBlock.style.padding = '10px';
        linkBlock.style.marginBottom = '8px';

        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.color = '#ffb300';
        title.style.marginBottom = '4px';
        title.textContent = `${m.linkName} (${m.count} photo(s) manquante(s))`;
        linkBlock.appendChild(title);

        const list = document.createElement('ul');
        list.style.margin = '0 0 0 16px';
        list.style.padding = '0';
        list.style.fontSize = '12px';
        list.style.color = 'var(--text-muted)';
        m.items.slice(0, 5).forEach(itemStr => {
          const li = document.createElement('li');
          li.textContent = itemStr;
          list.appendChild(li);
        });
        if (m.items.length > 5) {
          const liMore = document.createElement('li');
          liMore.textContent = `...et ${m.items.length - 5} autre(s)`;
          list.appendChild(liMore);
        }
        linkBlock.appendChild(list);
        body.appendChild(linkBlock);
      });

      const cleanup = () => {
        modal.classList.remove('active');
        btnConfirm.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        btnClose.removeEventListener('click', onCancel);
      };

      const onConfirm = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
      btnClose.addEventListener('click', onCancel);

      modal.classList.add('active');
    });
  }

  // Affichage du résumé final de l'export (Règle 2)
  showExportFinalSummary(results, subFolder) {
    const modal = document.getElementById('exportResultsModal');
    const titleEl = document.getElementById('exportResultsTitle');
    const bodyEl = document.getElementById('exportResultsBody');
    const btnOk = document.getElementById('btnOkExportResults');
    const btnClose = document.getElementById('btnCloseExportResults');

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    if (!modal || !bodyEl) {
      alert(`Export terminé :\n- ${successCount} réussi(s)\n- ${errorCount} en erreur`);
      return;
    }

    if (titleEl) {
      titleEl.textContent = errorCount === 0
        ? `Export Réussi (${successCount}/${results.length})`
        : `Export Partiel (${successCount}/${results.length} réussis)`;
    }

    bodyEl.innerHTML = '';

    const pathInfo = document.createElement('div');
    pathInfo.style.background = 'rgba(0, 102, 255, 0.1)';
    pathInfo.style.border = '1px solid rgba(0, 102, 255, 0.3)';
    pathInfo.style.borderRadius = 'var(--radius-sm)';
    pathInfo.style.padding = '10px';
    pathInfo.style.marginBottom = '12px';
    pathInfo.style.fontSize = '12px';
    pathInfo.innerHTML = `<strong>Emplacement des fichiers :</strong><br>Téléchargements/Nokia PM/${escapeHtml(subFolder)}/`;
    bodyEl.appendChild(pathInfo);

    results.forEach(res => {
      const item = document.createElement('div');
      item.style.padding = '8px 10px';
      item.style.borderRadius = 'var(--radius-sm)';
      item.style.marginBottom = '6px';
      item.style.display = 'flex';
      item.style.alignItems = 'flex-start';
      item.style.gap = '8px';

      if (res.success) {
        item.style.background = 'rgba(0, 230, 118, 0.08)';
        item.style.border = '1px solid rgba(0, 230, 118, 0.25)';
        item.innerHTML = `
          <span style="color: #00e676; font-size: 16px;">✓</span>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; color: #fff;">${escapeHtml(res.linkName)}</div>
            <div style="font-size: 11px; color: var(--text-muted); word-break: break-all;">${escapeHtml(res.fileName)}</div>
          </div>
        `;
      } else {
        item.style.background = 'rgba(255, 59, 48, 0.08)';
        item.style.border = '1px solid rgba(255, 59, 48, 0.25)';
        item.innerHTML = `
          <span style="color: #ff3b30; font-size: 16px;">✕</span>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; color: #fff;">${escapeHtml(res.linkName)}</div>
            <div style="font-size: 11px; color: #ff857d;">Erreur : ${escapeHtml(res.error || 'Échec')}</div>
          </div>
        `;
      }
      bodyEl.appendChild(item);
    });

    const closeHandler = () => {
      modal.classList.remove('active');
      btnOk?.removeEventListener('click', closeHandler);
      btnClose?.removeEventListener('click', closeHandler);
    };

    btnOk?.addEventListener('click', closeHandler);
    btnClose?.addEventListener('click', closeHandler);

    modal.classList.add('active');
  }

  // -------------------------------------------------------------
  // Export séquentiel de tous les link de la visite (Règles 1 à 6)
  // -------------------------------------------------------------
  async exportVisit(selectedLinkIds = null) {
    if (!this.currentVisit || !Array.isArray(this.currentVisit.links) || this.currentVisit.links.length === 0) {
      alert("Aucun link à exporter dans la visite.");
      return;
    }

    // Persister d'abord toute saisie en cours
    await this.flushAutoSave();

    const visit = this.currentVisit;
    const visitId = visit.id;

    // Filtrer les link si des IDs spécifiques sont demandés (Règle 5)
    const linksToExport = (Array.isArray(selectedLinkIds) && selectedLinkIds.length > 0)
      ? visit.links.filter(l => selectedLinkIds.includes(l.id))
      : visit.links;

    if (linksToExport.length === 0) {
      alert("Aucun link sélectionné pour l'export.");
      return;
    }

    const total = linksToExport.length;

    // 1. Récapituler les photos manquantes par link (Règle 3)
    const missingByLink = [];
    const siteData = (await window.pmDB.getState(`visit_${visitId}_site`)) || { common: {}, geotags: {} };

    for (const linkMeta of linksToExport) {
      const linkData = await window.pmDB.getState(`visit_${visitId}_link_${linkMeta.id}`);
      if (!linkData || !linkData.structure) continue;

      const iduData = (await window.pmDB.getState(`visit_${visitId}_idu_${linkMeta.iduId || 'idu_1'}`)) || {
        id: linkMeta.iduId || 'idu_1',
        inspections: {},
        geotags: {}
      };
      const missingItems = [];

      const sheets = (linkData.structure.sheets || []).filter(s => s.type === 'GEOTAG_PHOTO_REPORT' && !s.hidden);
      sheets.forEach(sheet => {
        (sheet.content?.items || []).forEach(it => {
          (it.slots || []).forEach(slot => {
            const slotKey = `${it.id}_s${slot.slotIndex}`;
            const hasPhoto = (linkData.geotags && linkData.geotags[slotKey]) ||
                             (iduData.geotags && iduData.geotags[slotKey]) ||
                             (siteData.geotags && siteData.geotags[slotKey]);
            if (!hasPhoto) {
              missingItems.push(`Item #${it.itemNo}: ${slot.instruction || it.description || 'Photo requise'}`);
            }
          });
        });
      });

      if (missingItems.length > 0) {
        missingByLink.push({
          linkName: linkMeta.name || linkMeta.hopName || ' Link',
          count: missingItems.length,
          items: missingItems
        });
      }
    }

    // Demander confirmation si des photos manquent (Règle 3)
    if (missingByLink.length > 0) {
      const proceed = await this.promptMissingPhotosConfirmation(missingByLink);
      if (!proceed) return;
    }

    const keepInstruction = document.getElementById('chkKeepInstruction')?.checked || false;
    const photoFitMode = document.getElementById('selectPhotoFitMode')?.value || 'fit';
    const siteNameForSubFolder = (siteData.common?.siteName || visit.siteName || 'Site')
      .trim().replace(/[^a-zA-Z0-9_-]/g, '_');

    // Démarrer la modal de progression
    this.showExportProgress(0, total, 'Démarrage de l\'export séquentiel...');

    const usedFileNames = new Set();
    const exportedUris = [];
    const results = [];

    // Traitement séquentiel avec libération mémoire après chaque link (Règle 1)
    for (let i = 0; i < total; i++) {
      const linkMeta = linksToExport[i];
      const linkNum = i + 1;
      this.updateExportProgress(linkNum, total, `Export link ${linkNum}/${total} : ${linkMeta.name}`);
      await new Promise(r => setTimeout(r, 80));

      try {
        let linkData = await window.pmDB.getState(`visit_${visitId}_link_${linkMeta.id}`);
        if (!linkData || !linkData.templateBuffer || !linkData.structure) {
          throw new Error(`Classeur template manquant pour ${linkMeta.name}`);
        }

        let iduData = (await window.pmDB.getState(`visit_${visitId}_idu_${linkMeta.iduId || 'idu_1'}`)) || {
          id: linkMeta.iduId || 'idu_1',
          inspections: {},
          geotags: {}
        };

        // Composer formData pour ce link
        let linkFormData = window.visitManager.composeFormData(
          visit,
          siteData,
          iduData,
          linkData,
          linkData.structure
        );

        // Générer le rapport Excel avec ExcelJS
        const buffer = await window.excelExporter.generateReport(
          linkData.templateBuffer,
          linkData.structure,
          linkFormData,
          {
            keepInstructionText: keepInstruction,
            photoFitMode: photoFitMode
          }
        );

        // Nom de fichier : PM_<SiteA>_<Hop>_<date>.xlsx avec gestion des doublons (Règle 4)
        const dateClean = (linkFormData.common.date || new Date().toISOString().slice(0, 10))
          .trim().replace(/[^a-zA-Z0-9_-]/g, '_');

        const equipment = this.getEquipmentName(linkFormData, linkData.structure);
        const baseName = this.buildReportBaseName(linkFormData.common, equipment, linkMeta.name);
        let fileName = `${baseName}.xlsx`;
        let counter = 2;
        while (usedFileNames.has(fileName.toLowerCase())) {
          fileName = `${baseName}_${counter}.xlsx`;
          counter++;
        }
        usedFileNames.add(fileName.toLowerCase());

        // Enregistrer le fichier
        let fileUri = '';
        if (window.AndroidBridge && typeof window.AndroidBridge.saveFileToDownloads === 'function') {
          const base64Data = this.arrayBufferToBase64(buffer);
          fileUri = window.AndroidBridge.saveFileToDownloads(
            base64Data,
            fileName,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            siteNameForSubFolder
          );
          if (fileUri) {
            exportedUris.push(fileUri);
          }
        } else {
          // Navigateur Web
          const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
          window.excelExporter.triggerBrowserDownload(blob, fileName);
        }

        // pmDB.saveReport par link SANS les photos (Règle 5)
        const strippedFormData = this.stripPhotosFromFormData(linkFormData);
        await window.pmDB.saveReport({
          id: `report_${linkMeta.id}_${Date.now()}`,
          visitId: visit.id,
          linkId: linkMeta.id,
          siteName: linkFormData.common.siteName || 'Site',
          hopName: linkFormData.common.hopName || linkMeta.name,
          date: dateClean,
          fileName: fileName,
          fileUri: fileUri || '',
          formData: strippedFormData,
          exportedAt: new Date().toISOString()
        });

        // Enregistrer l'horodatage du dernier export sur le link
        if (!linkMeta.summary) linkMeta.summary = {};
        linkMeta.summary.dernierExport = Date.now();

        results.push({
          linkName: linkMeta.name,
          fileName: fileName,
          success: true,
          uri: fileUri
        });

        // Libération explicite de la mémoire avant le link suivant (Règle 1)
        linkData = null;
        iduData = null;
        linkFormData = null;

      } catch (err) {
        console.error(`Erreur export link ${linkMeta.name}:`, err);
        // Règle 2 : Une erreur sur un link n'arrête pas les autres
        results.push({
          linkName: linkMeta.name,
          success: false,
          error: err.message || 'Erreur inconnue'
        });
      }
    }

    this.hideExportProgress();

    // Sauvegarder la visite avec les horodatages dernierExport mis à jour
    visit.updatedAt = new Date().toISOString();
    await window.pmDB.saveState(`visit_${visitId}`, visit);
    this.renderTrackingSection();

    // Partage Android unique à la fin de l'export
    if (window.AndroidBridge && typeof window.AndroidBridge.shareFiles === 'function' && exportedUris.length > 0) {
      window.AndroidBridge.shareFiles(
        JSON.stringify(exportedUris),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    }

    // Afficher le résumé final (Règle 2)
    this.showExportFinalSummary(results, siteNameForSubFolder);
    this.vibrate(100);
    this.loadSavedReportsList();
  }

  refreshReadiness() {
    const list = document.getElementById('readinessChecklist');
    list.innerHTML = '';

    const missingAlert = document.getElementById('missingItemsAlert');
    const missingPhotos = [];
    this.currentStructure?.sheets
      .filter(s => s.type === 'GEOTAG_PHOTO_REPORT' && !s.hidden)
      .forEach(sheet => {
        sheet.content.items?.forEach(it => {
          it.slots?.forEach(slot => {
            const slotKey = `${it.id}_s${slot.slotIndex}`;
            if (!this.formData.geotags[slotKey]) {
              missingPhotos.push(`Item #${it.itemNo}: ${slot.instruction}`);
            }
          });
        });
      });

    if (missingPhotos.length > 0) {
      missingAlert.style.display = 'block';
      missingAlert.className = 'alert alert-warning';
      missingAlert.innerHTML = `
        <strong>⚠️ ${missingPhotos.length} Photos Pending:</strong>
        <ul style="margin-left: 18px; margin-top: 4px;">
          ${missingPhotos.slice(0, 4).map(m => `<li>${m}</li>`).join('')}
          ${missingPhotos.length > 4 ? `<li>...and ${missingPhotos.length - 4} more</li>` : ''}
        </ul>
      `;
    } else {
      missingAlert.style.display = 'none';
    }

    const checks = [
      {
        label: 'Template & Sheets Structure',
        ready: !!(this.templateBuffer && this.currentStructure),
        desc: `${this.currentStructure?.summary.totalSheets || 0} sheets configured (${this.templateName || 'No template'})`
      },
      {
        label: 'Site & Hop Name',
        ready: !!(this.formData.common.siteName && this.formData.common.hopName),
        desc: `${this.formData.common.siteName || 'Missing'} - ${this.formData.common.hopName || 'Missing'}`
      },
      {
        label: 'GPS Coordinates',
        ready: !!(this.formData.common.siteLong && this.formData.common.siteLat),
        desc: `${this.formData.common.siteLong || 'Long N/A'}, ${this.formData.common.siteLat || 'Lat N/A'}`
      },
      {
        label: 'Physical Inspection Items',
        ready: Object.keys(this.formData.inspections).length > 0,
        desc: `${Object.keys(this.formData.inspections).length} items recorded`
      },
      {
        label: 'Geotagged Photos',
        ready: missingPhotos.length === 0 && (this.currentStructure?.summary.totalPhotoSlots || 0) > 0,
        desc: `${Object.keys(this.formData.geotags).length} / ${this.currentStructure?.summary.totalPhotoSlots || 0} photos captured`
      },
      {
        label: 'Tactile Signatures',
        ready: !!(this.formData.signatures.foeSig || this.formData.signatures.expertSig || this.formData.signatures.airtelSig),
        desc: `${[this.formData.signatures.foeSig ? 'FOE' : null, this.formData.signatures.expertSig ? 'Expert' : null, this.formData.signatures.airtelSig ? 'Airtel' : null].filter(Boolean).join(', ') || 'No signatures yet'}`
      }
    ];

    checks.forEach(c => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '8px 0';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

      row.innerHTML = `
        <div>
          <div style="font-size: 13px; font-weight: 600; color: #fff;">${c.label}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${c.desc}</div>
        </div>
        <span class="badge ${c.ready ? 'badge-success' : 'badge-outline'}">${c.ready ? 'Ready' : 'Pending'}</span>
      `;
      list.appendChild(row);
    });
  }

  async loadSavedReportsList() {
    const container = document.getElementById('savedReportsList');
    container.innerHTML = '';

    const reports = await window.pmDB.listReports();
    if (reports.length === 0) {
      container.innerHTML = '<div style="font-size: 12px; color: var(--text-muted);">No previously exported reports yet.</div>';
      return;
    }

    reports.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    reports.forEach(rep => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '10px 0';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

      row.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 13px; color: #fff;">${rep.siteName || 'Site PM'}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${rep.date} · ${rep.fileName}</div>
        </div>
        <button class="btn btn-sm btn-outline btn-restore-rep" data-id="${rep.id}">
          Open Draft
        </button>
      `;

      row.querySelector('.btn-restore-rep').addEventListener('click', async () => {
        const fullRep = await window.pmDB.getReport(rep.id);
        if (fullRep && fullRep.formData) {
          this.formData = fullRep.formData;
          this.applyFormDataToInputs();
          this.renderAllViews();
          this.showToast(`Restored draft for ${rep.siteName}`);
        }
      });

      container.appendChild(row);
    });
  }

  // autoSave débouncé (~800 ms) : décompose this.formData selon la portée de chaque donnée
  // et n'écrit que les enregistrements modifiés (SITE / IDU / LIEN).
  autoSave(immediate = false) {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (immediate) {
      return this.performAutoSave();
    }
    this.autoSaveTimer = setTimeout(() => {
      this.performAutoSave();
    }, 800);
  }

  async flushAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    return this.performAutoSave();
  }

  async performAutoSave() {
    try {
      if (!this.currentStructure || !this.templateBuffer) return;

      // Création automatique de la visite au premier enregistrement si nécessaire
      if (!this.currentVisit || !this.currentLinkId) {
        const siteName = this.formData.common.siteName || 'Site PM';
        const visit = window.visitManager.createVisit(siteName);
        const idu = window.visitManager.createIdu('IDU 1');
        visit.idus.push(idu);

        const linkId = 'link_' + Date.now();
        const hopName = this.formData.common.hopName || this.templateName || 'Hop 1';
        visit.links.push({
          id: linkId,
          name: hopName,
          iduId: idu.id,
          templateName: this.templateName || 'Site_Template.xlsx'
        });
        visit.activeLinkId = linkId;

        this.currentVisit = visit;
        this.currentLinkId = linkId;
        this.currentIduId = idu.id;
      }

      const visit = this.currentVisit;
      const visitId = visit.id;
      const linkId = this.currentLinkId;
      const iduId = this.currentIduId;

      // Décomposition selon les portées (SITE / IDU / LIEN)
      const { siteData, iduData, linkData } = window.visitManager.decomposeFormData(
        visit,
        this.formData,
        this.currentStructure,
        iduId,
        this.currentSiteData,
        this.currentIduData,
        null
      );

      // 1. Sauvegarder la portée SITE si modifiée
      const siteStr = JSON.stringify(siteData);
      let siteChanged = false;
      if (this.lastSavedHashes.site !== siteStr) {
        await window.pmDB.saveState(`visit_${visitId}_site`, siteData);
        this.currentSiteData = siteData;
        this.lastSavedHashes.site = siteStr;
        siteChanged = true;
      }

      // 2. Sauvegarder la portée IDU si modifiée
      const iduStr = JSON.stringify(iduData);
      let iduChanged = false;
      if (this.lastSavedHashes.idu !== iduStr) {
        await window.pmDB.saveState(`visit_${visitId}_idu_${iduId}`, iduData);
        this.currentIduData = iduData;
        this.lastSavedHashes.idu = iduStr;
        iduChanged = true;
      }

      // Règle 4 : Si des données communes (site ou IDU) changent alors qu'un link était déjà exporté,
      // son dernierChangement passe à maintenant SANS réinitialiser termine
      const nowTs = Date.now();
      if (siteChanged) {
        visit.links.forEach(l => {
          if (l.summary) l.summary.dernierChangement = nowTs;
        });
      }
      if (iduChanged) {
        visit.links.forEach(l => {
          if (l.iduId === iduId && l.summary) l.summary.dernierChangement = nowTs;
        });
      }

      // 3. Sauvegarder la portée LIEN (propre au link actif)
      const fullLinkData = Object.assign({}, linkData, {
        id: linkId,
        templateBuffer: this.templateBuffer,
        templateName: this.templateName,
        structure: this.currentStructure
      });
      await window.pmDB.saveState(`visit_${visitId}_link_${linkId}`, fullLinkData);

      // 4. Mettre à jour les métadonnées de la visite et les résumés (sans photos !)
      const currentLinkMeta = visit.links.find(l => l.id === linkId);
      if (currentLinkMeta) {
        if (this.formData.common.hopName) currentLinkMeta.name = this.formData.common.hopName;
        currentLinkMeta.templateName = this.templateName;
        currentLinkMeta.summary = window.visitManager.computeLinkSummary(
          this.formData,
          this.currentStructure,
          currentLinkMeta.summary
        );
      }
      if (this.formData.common.siteName) {
        visit.name = this.formData.common.siteName;
      }

      // Résumé global du site et des groupes IDU
      visit.siteSummary = window.visitManager.computeSiteSummary(this.currentSiteData || siteData);
      visit.idus.forEach(idu => {
        if (idu.id === iduId) {
          idu.summary = window.visitManager.computeIduSummary(this.currentIduData || iduData);
        }
      });

      visit.updatedAt = new Date().toISOString();
      await window.pmDB.saveState(`visit_${visitId}`, visit);
      await window.pmDB.saveState('app_active_visit', visitId);

      // Rafraîchir l'écran de suivi si l'onglet Visite est actif
      const activeNavTab = document.querySelector('.nav-tab.active')?.getAttribute('data-tab');
      if (activeNavTab === 'tab-visit') {
        this.renderTrackingSection();
      }

      // 5. Sauvegarde de secours rétrocompatible
      await window.pmDB.saveState('active_report', {
        id: this.currentReportId,
        buffer: this.templateBuffer,
        templateName: this.templateName,
        structure: this.currentStructure,
        formData: this.formData,
        updatedAt: new Date().toISOString()
      });

      this.showSavedIndicator('Auto-saved');
    } catch (e) {
      console.warn('Auto-save warning:', e);
    }
  }

  showSavedIndicator(msg) {
    const badge = document.getElementById('autoSavedBadge');
    if (badge) {
      badge.textContent = msg;
      badge.style.display = 'inline-flex';
      setTimeout(() => {
        badge.style.display = 'none';
      }, 2000);
    }
  }

  showToast(message) {
    if (window.AndroidBridge && typeof window.AndroidBridge.showToast === 'function') {
      window.AndroidBridge.showToast(message);
    }
  }

  vibrate(ms) {
    if (window.AndroidBridge && typeof window.AndroidBridge.vibrate === 'function') {
      window.AndroidBridge.vibrate(ms);
    } else if (navigator.vibrate) {
      navigator.vibrate(ms);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new NokiaPMApp();
  window.app.init();
});
