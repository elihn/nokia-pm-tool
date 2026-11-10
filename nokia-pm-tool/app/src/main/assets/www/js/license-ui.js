/**
 * Nokia PM Tool - Gestionnaire UI du Système de Licences
 * Gère l'affichage du statut, l'activation initiale, la synchronisation 30 jours,
 * et la protection des exportations.
 */

(function () {
  'use strict';

  let currentLicenseInfo = {
    status: 'UNLICENSED',
    statusLabel: 'Non Activé',
    badgeColor: '#94a3b8',
    licenseKey: '',
    technicianName: 'Inconnu',
    technicianCompany: 'Non assigné',
    durationType: '',
    licenseExpiresAt: '',
    offlineValidUntil: '',
    remainingOfflineDays: 0,
    lastSyncFormatted: 'Jamais',
    installationId: '',
    isOperationAllowed: false,
    statusMessage: 'Aucune licence active.'
  };

  function initLicenseSystem() {
    createLicenseModals();
    attachHeaderLicenseButton();
    refreshLicenseStatus();
  }

  function getBridge() {
    return window.AndroidBridge || null;
  }

  function refreshLicenseStatus() {
    const bridge = getBridge();
    if (bridge && typeof bridge.getLicenseInfo === 'function') {
      try {
        const raw = bridge.getLicenseInfo();
        const info = JSON.parse(raw);
        updateLicenseDisplay(info);
      } catch (e) {
        console.error('Erreur lecture licence depuis AndroidBridge', e);
      }
    } else {
      // Mode navigateur / dev fallback
      console.log('Mode Web: simulation de statut de licence active');
      updateLicenseDisplay({
        status: 'ACTIVE',
        statusLabel: 'Actif (Dev Web)',
        badgeColor: '#10b981',
        licenseKey: 'NOKIA-DEMO-TEST-2025',
        technicianName: 'Technicien Démo',
        technicianCompany: 'Nokia Field Test',
        durationType: '1_YEAR',
        licenseExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        offlineValidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        remainingOfflineDays: 30,
        lastSyncFormatted: 'Aujourd\'hui',
        installationId: 'DEV_BROWSER_ID_001',
        isOperationAllowed: true,
        statusMessage: 'Environnement de développement navigateur.'
      });
    }
  }

  function updateLicenseDisplay(info) {
    currentLicenseInfo = info;

    // Mise à jour du badge dans l'en-tête
    const headerBtn = document.getElementById('btnLicenseStatusHeader');
    const headerDot = document.getElementById('licenseHeaderDot');
    const headerText = document.getElementById('licenseHeaderText');

    if (headerBtn && headerDot && headerText) {
      headerDot.style.color = info.badgeColor || '#10b981';
      headerText.textContent = info.statusLabel || 'Licence';
      headerBtn.style.borderColor = info.badgeColor || 'rgba(0, 180, 216, 0.4)';
    }

    // Mise à jour de la modal d'information si ouverte
    updateModalContent(info);

    // Si aucune licence n'est présente au démarrage, proposer l'activation
    if (info.status === 'UNLICENSED' && !sessionStorage.getItem('lic_prompt_shown')) {
      sessionStorage.setItem('lic_prompt_shown', 'true');
      openActivationModal();
    }
  }

  // Notifié depuis Kotlin via evaluateJavascript
  window.onLicenseStatusUpdated = function (info) {
    updateLicenseDisplay(info);
    if (window.showToast) {
      window.showToast('Licence mise à jour : ' + (info.statusLabel || info.status));
    }
  };

  function maskLicenseKey(key) {
    if (!key || key.length < 8) return '••••-••••';
    const parts = key.split('-');
    if (parts.length >= 3) {
      return `${parts[0]}-••••-••••-${parts[parts.length - 1]}`;
    }
    return key.slice(0, 4) + '••••' + key.slice(-4);
  }

  function updateModalContent(info) {
    const statusPill = document.getElementById('licModalStatusPill');
    const techName = document.getElementById('licModalTechName');
    const techCompany = document.getElementById('licModalTechCompany');
    const keyEl = document.getElementById('licModalKey');
    const durationEl = document.getElementById('licModalDuration');
    const expEl = document.getElementById('licModalExpires');
    const offlineDaysEl = document.getElementById('licModalOfflineDays');
    const lastSyncEl = document.getElementById('licModalLastSync');
    const installIdEl = document.getElementById('licModalInstallId');
    const msgEl = document.getElementById('licModalStatusMessage');

    if (statusPill) {
      statusPill.textContent = info.statusLabel;
      statusPill.style.background = info.badgeColor ? `${info.badgeColor}22` : '#10b98122';
      statusPill.style.color = info.badgeColor || '#10b981';
      statusPill.style.borderColor = info.badgeColor || '#10b981';
    }

    if (techName) techName.textContent = info.technicianName || 'Non assigné';
    if (techCompany) techCompany.textContent = info.technicianCompany || 'Nokia Field';
    if (keyEl) keyEl.textContent = maskLicenseKey(info.licenseKey);
    if (durationEl) durationEl.textContent = (info.durationType || '1 Mois').replace('_', ' ');

    if (expEl) {
      if (info.durationType === 'PERMANENT') {
        expEl.textContent = 'Permanente (Illimitée)';
      } else if (info.licenseExpiresAt) {
        expEl.textContent = new Date(info.licenseExpiresAt).toLocaleDateString('fr-FR');
      } else {
        expEl.textContent = '-';
      }
    }

    if (offlineDaysEl) {
      offlineDaysEl.textContent = `${info.remainingOfflineDays} jour(s) restant(s)`;
      if (info.remainingOfflineDays <= 5) {
        offlineDaysEl.style.color = '#ef4444';
        offlineDaysEl.style.fontWeight = '700';
      } else {
        offlineDaysEl.style.color = '#00e5ff';
        offlineDaysEl.style.fontWeight = '600';
      }
    }

    if (lastSyncEl) lastSyncEl.textContent = info.lastSyncFormatted || 'Jamais';
    if (installIdEl) installIdEl.textContent = info.installationId || '-';
    if (msgEl) msgEl.textContent = info.statusMessage || '';
  }

  function createLicenseModals() {
    // 1. Modal "INFORMATIONS DE LICENCE"
    const infoModal = document.createElement('div');
    infoModal.className = 'modal-overlay';
    infoModal.id = 'licenseInfoModal';
    infoModal.innerHTML = `
      <div class="modal-content" style="max-width: 480px; max-height: 88vh; display: flex; flex-direction: column; background: #0c1524; border: 1px solid rgba(0, 180, 216, 0.35); box-shadow: 0 10px 30px rgba(0,0,0,0.6);">
        <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px; font-size: 16px; color: #70d6ff; font-weight: 700;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            INFORMATIONS DE LICENCE
          </div>
          <button class="close-btn" id="btnCloseLicenseInfo">&times;</button>
        </div>

        <div style="overflow-y: auto; padding: 12px 2px; font-size: 13px;">
          <!-- Statut Général -->
          <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">Statut de l'appareil</span>
              <span id="licModalStatusPill" style="font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; border: 1px solid;">ACTIF</span>
            </div>
            <div id="licModalStatusMessage" style="font-size: 12px; color: #e2e8f0; line-height: 1.4;"></div>
          </div>

          <!-- Détails Technicien & Licence -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
            <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Technicien Habilité</div>
              <div id="licModalTechName" style="font-weight: 600; color: #fff; margin-top: 2px;">-</div>
              <div id="licModalTechCompany" style="font-size: 11px; color: #94a3b8;">-</div>
            </div>
            <div style="background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Clé Attribuée</div>
              <div id="licModalKey" style="font-family: monospace; font-weight: 600; color: #70d6ff; margin-top: 2px;">-</div>
              <div id="licModalDuration" style="font-size: 11px; color: #94a3b8;">-</div>
            </div>
          </div>

          <!-- Dates & Mode Hors-ligne -->
          <div style="background: rgba(0, 180, 216, 0.05); border: 1px solid rgba(0, 180, 216, 0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <span style="color: var(--text-muted); font-size: 11px;">Validité Hors-Ligne (30j) :</span>
              <span id="licModalOfflineDays" style="font-weight: 600; color: #00e5ff;">30 jours</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <span style="color: var(--text-muted); font-size: 11px;">Date d'Expiration Licence :</span>
              <span id="licModalExpires" style="font-weight: 500; color: #fff;">-</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-muted); font-size: 11px;">Dernière Synchronisation :</span>
              <span id="licModalLastSync" style="font-weight: 500; color: #fff;">-</span>
            </div>
          </div>

          <!-- Identifiant Matériel (Support) -->
          <div style="background: rgba(255,255,255,0.02); padding: 8px 10px; border-radius: 6px; margin-bottom: 14px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text-muted);">ID Matériel :</span>
            <span id="licModalInstallId" style="font-family: monospace; font-size: 10px; color: #94a3b8;">-</span>
          </div>

          <!-- Actions -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button class="btn btn-primary btn-full" id="btnSyncLicenseNow" style="font-weight: 700; background: linear-gradient(135deg, #0066ff, #00b4d8); border: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              Synchroniser maintenant (renouveler 30 jours)
            </button>
            <button class="btn btn-outline btn-full" id="btnOpenActivateFromInfo" style="font-size: 12px;">
              Activer une autre clé de licence
            </button>
          </div>

          <!-- Accordéon Options Avancées / Serveur -->
          <div style="margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
            <div id="btnToggleServerConfig" style="font-size: 11px; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
              <span>Paramètres Serveur Avancés</span>
              <span>▼</span>
            </div>
            <div id="serverConfigPanel" style="display: none; margin-top: 8px;">
              <div class="form-group" style="margin-bottom: 6px;">
                <label style="font-size: 10px;">URL du Serveur de Licence</label>
                <input type="text" id="licCustomServerInput" placeholder="Ex: http://10.0.2.2:3001 ou Supabase" style="font-size: 11px; padding: 6px;">
              </div>
              <button class="btn btn-sm btn-outline" id="btnSaveCustomServer" style="font-size: 11px; width: 100%;">
                Enregistrer l'URL
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(infoModal);

    // 2. Modal "ACTIVATION DE LA LICENCE"
    const actModal = document.createElement('div');
    actModal.className = 'modal-overlay';
    actModal.id = 'licenseActivationModal';
    actModal.innerHTML = `
      <div class="modal-content" style="max-width: 440px; background: #0c1524; border: 1px solid rgba(0, 102, 255, 0.4); box-shadow: 0 12px 35px rgba(0,0,0,0.7);">
        <div class="modal-header">
          <div class="modal-title" style="color: #70d6ff; font-weight: 700; display: flex; align-items: center; gap: 8px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            Activation Nokia PM Tool
          </div>
          <button class="close-btn" id="btnCloseActivationModal">&times;</button>
        </div>

        <div style="font-size: 13px; margin: 10px 0 16px; color: #cbd5e1; line-height: 1.45;">
          Une licence active est requise pour générer et exporter les rapports Excel Nokia PM.
          <ul style="margin: 8px 0 8px 18px; font-size: 12px; color: #94a3b8;">
            <li>Activation initiale obligatoire avec connexion Internet.</li>
            <li>1 licence = 1 seul smartphone autorisé.</li>
            <li>Validité <strong>30 jours consécutifs hors-ligne</strong> après activation.</li>
          </ul>
        </div>

        <div class="form-group" style="margin-bottom: 14px;">
          <label style="font-weight: 600; font-size: 12px; color: #70d6ff;">Clé de Licence Nokia *</label>
          <input type="text" id="licActivationKeyInput" placeholder="NOKIA-XXXX-XXXX-XXXX" style="font-family: monospace; font-size: 14px; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; padding: 10px; border-color: rgba(0, 102, 255, 0.4);">
        </div>

        <div id="activationErrorMsg" style="display: none; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 6px; padding: 8px; font-size: 11px; color: #fca5a5; margin-bottom: 12px;"></div>

        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outline" style="flex: 1;" id="btnCancelActivation">Annuler</button>
          <button class="btn btn-primary" style="flex: 1.5; font-weight: 700;" id="btnSubmitActivation">
            Activer ce téléphone
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(actModal);

    // Événements modales
    document.getElementById('btnCloseLicenseInfo').onclick = () => {
      document.getElementById('licenseInfoModal').classList.remove('active');
    };
    document.getElementById('btnCloseActivationModal').onclick = () => {
      document.getElementById('licenseActivationModal').classList.remove('active');
    };
    document.getElementById('btnCancelActivation').onclick = () => {
      document.getElementById('licenseActivationModal').classList.remove('active');
    };

    document.getElementById('btnOpenActivateFromInfo').onclick = () => {
      document.getElementById('licenseInfoModal').classList.remove('active');
      openActivationModal();
    };

    document.getElementById('btnSyncLicenseNow').onclick = triggerSync;
    document.getElementById('btnSubmitActivation').onclick = triggerActivation;

    // Toggle configuration serveur
    const btnToggle = document.getElementById('btnToggleServerConfig');
    const panel = document.getElementById('serverConfigPanel');
    btnToggle.onclick = () => {
      const isHidden = panel.style.display === 'none';
      panel.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        const bridge = getBridge();
        const curUrl = bridge && typeof bridge.getLicenseServerUrl === 'function' ? bridge.getLicenseServerUrl() : '';
        document.getElementById('licCustomServerInput').value = curUrl;
      }
    };

    document.getElementById('btnSaveCustomServer').onclick = () => {
      const newUrl = document.getElementById('licCustomServerInput').value.trim();
      const bridge = getBridge();
      if (bridge && typeof bridge.setLicenseServerUrl === 'function') {
        bridge.setLicenseServerUrl(newUrl);
        if (window.showToast) window.showToast('URL du serveur enregistrée.');
      }
    };
  }

  function attachHeaderLicenseButton() {
    const headerStatus = document.querySelector('.header-status');
    if (headerStatus && !document.getElementById('btnLicenseStatusHeader')) {
      const btn = document.createElement('button');
      btn.id = 'btnLicenseStatusHeader';
      btn.className = 'badge';
      btn.style.cursor = 'pointer';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '4px';
      btn.style.background = 'rgba(0, 180, 216, 0.18)';
      btn.style.border = '1px solid rgba(0, 180, 216, 0.4)';
      btn.style.color = '#70d6ff';
      btn.style.fontWeight = '600';
      btn.style.fontSize = '11px';
      btn.style.padding = '3px 8px';
      btn.style.borderRadius = '999px';
      btn.style.marginLeft = '4px';
      btn.innerHTML = `
        <span id="licenseHeaderDot" style="font-size: 8px; color: #10b981;">●</span>
        <span id="licenseHeaderText">Licence</span>
      `;
      btn.onclick = openLicenseModal;
      headerStatus.appendChild(btn);
    }
  }

  function openLicenseModal() {
    refreshLicenseStatus();
    const modal = document.getElementById('licenseInfoModal');
    if (modal) modal.classList.add('active');
  }

  function openActivationModal() {
    const errBox = document.getElementById('activationErrorMsg');
    if (errBox) errBox.style.display = 'none';
    const modal = document.getElementById('licenseActivationModal');
    if (modal) modal.classList.add('active');
  }

  function triggerSync() {
    const btn = document.getElementById('btnSyncLicenseNow');
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Synchronisation en cours...';

    const bridge = getBridge();
    if (bridge && typeof bridge.syncLicense === 'function') {
      bridge.syncLicense('', 'window.onLicenseSyncResult');
    } else {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = oldText;
        if (window.showToast) window.showToast('Synchronisation simulée avec succès.');
      }, 1000);
    }
  }

  window.onLicenseSyncResult = function (res) {
    const btn = document.getElementById('btnSyncLicenseNow');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
        </svg>
        Synchroniser maintenant (renouveler 30 jours)
      `;
    }

    if (res.success) {
      if (window.showToast) window.showToast(res.message || 'Licence synchronisée avec succès !');
      updateLicenseDisplay(res.info);
    } else {
      alert('Échec de la synchronisation : ' + (res.error || 'Erreur réseau'));
    }
  };

  function triggerActivation() {
    const keyInput = document.getElementById('licActivationKeyInput');
    const key = (keyInput.value || '').trim().toUpperCase();
    const errBox = document.getElementById('activationErrorMsg');

    if (!key) {
      errBox.textContent = 'Veuillez saisir votre clé de licence.';
      errBox.style.display = 'block';
      return;
    }

    const btn = document.getElementById('btnSubmitActivation');
    btn.disabled = true;
    btn.textContent = 'Activation en cours...';

    const bridge = getBridge();
    if (bridge && typeof bridge.activateLicense === 'function') {
      bridge.activateLicense(key, '', 'window.onLicenseActivationResult');
    } else {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Activer ce téléphone';
        document.getElementById('licenseActivationModal').classList.remove('active');
        if (window.showToast) window.showToast('Licence activée avec succès !');
      }, 1000);
    }
  }

  window.onLicenseActivationResult = function (res) {
    const btn = document.getElementById('btnSubmitActivation');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Activer ce téléphone';
    }

    if (res.success) {
      document.getElementById('licenseActivationModal').classList.remove('active');
      if (window.showToast) window.showToast('Licence activée avec succès !');
      updateLicenseDisplay(res.info);
      openLicenseModal();
    } else {
      const errBox = document.getElementById('activationErrorMsg');
      if (errBox) {
        errBox.textContent = res.error || 'Échec de l\'activation.';
        errBox.style.display = 'block';
      }
    }
  };

  // Expose methods globally
  window.openLicenseModal = openLicenseModal;
  window.openActivationModal = openActivationModal;
  window.getLicenseStatus = () => currentLicenseInfo;

  // Initialisation dès chargement DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLicenseSystem);
  } else {
    initLicenseSystem();
  }
})();
