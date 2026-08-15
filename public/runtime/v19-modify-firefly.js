/**
 * Provider split runtime bridge:
 * Modify in GenStudio → Gemini only.
 * Regenerate creative → Adobe Firefly only.
 */
(function () {
  'use strict';

  if (typeof state === 'undefined') return;

  state.damGeneratePhase = state.damGeneratePhase || null;
  state.damGenerateError = state.damGenerateError || null;

  const DEMO_ASSET_IDS = new Set(['DAM-0231', 'DAM-0188', 'REQ-LI-WEB']);

  function campaignBriefFromState() {
    return {
      campaignName: state.campaignName,
      objective: state.objective,
      audience: state.audience,
      proposition: 'Discover what is possible with iPortal',
      product: 'iPortal',
      channels: state.channels || ['Email', 'LinkedIn']
    };
  }

  function modificationFingerprint(mod) {
    return [mod.title || '', mod.description || '', mod.cta || '', mod.prompt || ''].join('\u0001');
  }

  /**
   * The selected asset a channel output must be built from. Each channel/format slot holds
   * exactly one current asset, so a generated replacement is simply the slot's own record.
   */
  function selectedAssetForChannel(channelPattern) {
    const selected = (state.assets || []).filter(
      (a) => a.included && channelPattern.test(String(a.channel))
    );
    const generated = selected.find((a) => a.derived || a.generationSource);
    return generated || selected[0] || null;
  }

  function channelPatternForOutput(output) {
    const channel = String((output && output.channel) || '');
    if (/email/i.test(channel)) return /email/i;
    if (/linkedin/i.test(channel)) return /linkedin/i;
    return null;
  }

  /** Copy the selected asset's identity, content and visual onto its channel output. */
  function applyOutputFromAsset(output, asset) {
    if (!output || !asset) return;
    // A different accepted asset makes an already-accepted output stale: it returns to draft.
    if (output.assetId && output.assetId !== asset.id && output.approved) {
      output.approved = false;
      delete state.acceptedAssets[6];
      state.completed.delete(6);
    }
    output.headline = asset.headline || output.headline;
    output.body = asset.copy || output.body;
    output.cta = asset.cta || output.cta;
    // asset.id is the current slot asset; root DAM identity stays lineage only.
    output.assetId = asset.id;
    output.sourceAssetIds = [asset.id];
    output.generated = Boolean(asset.derived || asset.generated);
    output.generationSource = asset.generationSource || null;
    // Lineage stays on the root DAM asset even though the slot now holds a derivative.
    output.derivedFromAssetId =
      asset.rootSourceDamAssetId || asset.sourceAssetId || asset.sourceId || null;
    // Selection-driven: an asset without its own visual restores the original V19 creative.
    if (asset.imageUrl) output.imageUrl = asset.imageUrl;
    else delete output.imageUrl;
  }

  window.syncOutputsFromSelectedAssets = function syncOutputsFromSelectedAssets() {
    if (!state.outputs) return;
    applyOutputFromAsset(state.outputs.email, selectedAssetForChannel(/email/i));
    applyOutputFromAsset(state.outputs.linkedin, selectedAssetForChannel(/linkedin/i));
    state.outputSelectionSignature = selectionSignature();
  };

  /** Identity of everything the channel outputs are derived from. */
  function selectionSignature() {
    return (state.assets || [])
      .filter((a) => a.included)
      .map((a) => a.id + '@' + (a.imageUrl || ''))
      .join('|');
  }

  /**
   * Downstream invalidation: whenever the accepted Stage 6 selection differs from the one the
   * channel outputs were built from, the outputs are rebuilt before Stage 7 renders. Manual
   * output edits survive, because an unchanged selection never triggers a resync.
   */
  function refreshOutputsForSelectionChange() {
    if (!state.outputs) return;
    if (state.outputSelectionSignature === selectionSignature()) return;
    syncOutputsFromSelectedAssets();
  }

  const previousBeginStageGeneration = window.beginStageGeneration || beginStageGeneration;
  window.beginStageGeneration = function (i, label, prompt, onComplete) {
    if (i === 6) {
      syncOutputsFromSelectedAssets();
    }
    return previousBeginStageGeneration(i, label, prompt, onComplete);
  };
  if (typeof beginStageGeneration !== 'undefined') beginStageGeneration = window.beginStageGeneration;

  const previousToggleAsset = typeof toggleAsset === 'function' ? toggleAsset : null;
  if (previousToggleAsset) {
    window.toggleAsset = function (i) {
      const result = previousToggleAsset(i);
      syncOutputsFromSelectedAssets();
      renderAll();
      return result;
    };
    toggleAsset = window.toggleAsset;
  }

  // Acceptance is committed asynchronously, so the outputs are rebuilt from the committed
  // state and Stage 7 is rerendered once the accepted asset record exists.
  const previousBeginAssetRegistration =
    typeof beginAssetRegistration === 'function' ? beginAssetRegistration : null;
  if (previousBeginAssetRegistration) {
    window.beginAssetRegistration = function (i, label, onRegistered) {
      if (i !== 5) return previousBeginAssetRegistration(i, label, onRegistered);
      return previousBeginAssetRegistration(i, label, function (id) {
        if (onRegistered) onRegistered(id);
        syncOutputsFromSelectedAssets();
        renderAll();
      });
    };
    beginAssetRegistration = window.beginAssetRegistration;
  }

  function isGeminiGenerationSource(source) {
    return source === 'gemini' || source === 'gemini-image';
  }

  /** Visual used as the Gemini edit source: whatever the slot currently displays. */
  function resolveEditSourceImageUrl(asset) {
    if (asset && asset.imageUrl) return asset.imageUrl;
    if (typeof window !== 'undefined' && window.IPORTAL_CREATIVE) return window.IPORTAL_CREATIVE;
    return undefined;
  }

  function rootSourceDamIdFor(asset) {
    if (!asset) return null;
    if (!asset.derived) return asset.id;
    return asset.rootSourceDamAssetId || asset.sourceAssetId || asset.sourceId || asset.id;
  }

  /** Fields the root DAM record owns, kept verbatim so provenance survives replacement. */
  const ROOT_SNAPSHOT_FIELDS = [
    'id',
    'name',
    'requirement',
    'sourceType',
    'channel',
    'format',
    'dimensions',
    'modified',
    'approval',
    'rights',
    'expiry',
    'matchStatus',
    'matchClass',
    'confidence',
    'matchReason',
    'found',
    'generated',
    'adapted',
    'previewType',
    'headline',
    'copy',
    'cta',
    'imageUrl',
    'lineage'
  ];

  function snapshotRootAsset(asset) {
    const snapshot = {};
    for (const field of ROOT_SNAPSHOT_FIELDS) snapshot[field] = asset[field];
    return snapshot;
  }

  /**
   * Best-effort native size of the generated file (display only; file is never altered).
   * Only used when the server did not report the raw provider output size, because the
   * displayed file may be a channel-adapted crop rather than the provider output.
   */
  function probeGeneratedSourceDimensions(record) {
    if (record.sourceDimensions) return;
    if (!record.imageUrl || typeof Image === 'undefined') return;
    const probe = new Image();
    probe.onload = function () {
      if (!probe.naturalWidth || !probe.naturalHeight) return;
      record.sourceDimensions = probe.naturalWidth + ' × ' + probe.naturalHeight;
      renderAll();
    };
    probe.src = record.imageUrl;
  }

  /**
   * The generated creative replaces the asset currently displayed in its channel/format slot.
   * The slot keeps its requirement, channel, format, comments thread and campaign selection,
   * while identity, visual and content move to the new derivative. Lineage is retained on the
   * record (root DAM snapshot plus an edit chain) instead of as extra library entries.
   */
  function replaceSlotWithDerivative(slot, derived) {
    const editSourceAssetId = derived.editSourceAssetId || slot.id;
    const rootSourceDamAssetId =
      derived.rootSourceDamAssetId || (slot.derived ? rootSourceDamIdFor(slot) : slot.id);
    const rootAssetSnapshot = slot.rootAssetSnapshot || snapshotRootAsset(slot);

    slot.rootAssetSnapshot = rootAssetSnapshot;
    slot.id = derived.id;
    slot.name = derived.name || rootAssetSnapshot.name + ' · Generated derivative';
    // Keep internal provider identifiers; marketer-facing labels are neutralized at render time.
    slot.sourceType = derived.sourceType || (isGeminiGenerationSource(derived.generationSource) ? 'Gemini' : 'Adobe Firefly');
    slot.modified = 'Just now';
    slot.approval = derived.approval || 'Automated brand check passed';
    slot.matchStatus = derived.matchStatus || 'AI-modified';
    slot.matchClass = 'success';
    slot.confidence = derived.confidence || 'Campaign-ready draft';
    slot.found = true;
    slot.generated = true;
    slot.adapted = true;
    slot.derived = true;
    slot.generationSource = derived.generationSource;
    slot.referenceSource = derived.referenceSource;
    slot.sourceAssetId = rootSourceDamAssetId;
    slot.rootSourceDamAssetId = rootSourceDamAssetId;
    slot.editSourceAssetId = editSourceAssetId;
    slot.derivedFromAssetId = derived.derivedFromAssetId || editSourceAssetId;
    slot.lineage = derived.lineage;
    slot.jobId = derived.jobId;
    // Image actions are visual-only: Title / Description / CTA stay on the slot.
    slot.headline = slot.headline;
    slot.copy = slot.copy;
    slot.cta = slot.cta;
    slot.imageUrl = derived.imageUrl;
    slot.creativeSpecification = derived.creativeSpecification;
    slot.visualFamily = derived.visualFamily;
    slot.previewType = 'generated';
    slot.version = (slot.version || 1) + 1;
    // Source image is the raw provider output, never the channel-adapted crop.
    slot.sourceDimensions = derived.sourceImageDimensions || undefined;
    slot.sourceImageUrl = derived.sourceImageUrl;
    slot.sourceImageId = derived.sourceImageId;
    slot.targetDimensions = derived.targetDimensions;
    slot.finalImageDimensions = derived.finalImageDimensions;
    slot.formatAdaptation = derived.formatAdaptation;
    slot.genStudioContext = Object.assign({}, slot.genStudioContext || {}, {
      sourceId: rootSourceDamAssetId,
      editSourceAssetId,
      rootSourceDamAssetId,
      lastModificationFingerprint: modificationFingerprint(slot.pendingRequest || {})
    });
    slot.derivativeHistory = (slot.derivativeHistory || []).concat([
      {
        id: derived.id,
        editSourceAssetId,
        derivedFromAssetId: slot.derivedFromAssetId,
        rootSourceDamAssetId,
        imageUrl: derived.imageUrl,
        jobId: derived.jobId,
        generationSource: derived.generationSource
      }
    ]);
    slot.externalApprovalStatus = 'Not requested';
    slot.externalReviewerId = null;
    slot.externalApprovalRequestedAt = null;
    slot.externalApprovalCompletedAt = null;
    slot.externalApprovedVersion = null;

    probeGeneratedSourceDimensions(slot);
    return slot;
  }

  function phaseLabel(phase, found) {
    if (phase === 'editing') return 'Editing asset…';
    if (phase === 'updating_copy') return 'Updating campaign content…';
    if (phase === 'generating') return 'Generating creative…';
    if (phase === 'ready') return 'Asset updated';
    return found ? 'Editing asset…' : 'Generating creative…';
  }

  /** Marketer-facing source label — never exposes provider names. */
  function displaySourceLabel(asset) {
    if (!asset) return 'Adobe DAM';
    if (
      asset.derived ||
      isGeminiGenerationSource(asset.generationSource) ||
      asset.generationSource === 'firefly' ||
      asset.sourceType === 'Gemini' ||
      asset.sourceType === 'Adobe Firefly'
    ) {
      return 'AI-assisted';
    }
    if (asset.sourceType === 'Requirement') return 'Adobe DAM search';
    return asset.sourceType || 'Adobe DAM';
  }

  /** Neutralize provider names in lineage for display only. Internal lineage is unchanged. */
  function displayLineage(asset) {
    const raw = String(asset && asset.lineage ? asset.lineage : '');
    if (raw) {
      return esc(
        raw
          .replace(/Gemini image edit/gi, 'AI-assisted modification')
          .replace(/Gemini Creative Interpreter/gi, 'AI-assisted modification')
          .replace(/Gemini edit/gi, 'AI-assisted modification')
          .replace(/Gemini/gi, 'AI-assisted')
          .replace(/Adobe Firefly generation/gi, 'AI-assisted regeneration')
          .replace(/Firefly derivative/gi, 'AI-assisted regeneration')
          .replace(/Adobe Firefly/gi, 'AI-assisted regeneration')
          .replace(/Firefly/gi, 'AI-assisted regeneration')
          .replace(/Adobe GenStudio/gi, 'AI-assisted')
          .replace(/GenStudio/gi, 'AI-assisted')
          .replace(/channel crop\/format adaptation/gi, 'channel format adaptation')
      );
    }
    if (asset && asset.adapted) {
      return `Original DAM asset · ${esc(asset.rootSourceDamAssetId || asset.sourceAssetId || asset.id)} → AI-assisted modification`;
    }
    if (asset && asset.generated) {
      return `Original DAM asset · ${esc(asset.rootSourceDamAssetId || asset.sourceAssetId || asset.id)} → AI-assisted regeneration`;
    }
    if (asset && asset.found) return `Original DAM asset · ${esc(asset.id)}`;
    return 'Campaign requirement · no DAM match';
  }

  function neutralizeMarketerMessage(message) {
    const text = String(message || '');
    if (/timed out/i.test(text)) {
      return 'Image editing timed out. The current asset was left unchanged.';
    }
    if (/not configured|unavailable|could not be supplied|could not preserve/i.test(text)) {
      return text
        .replace(/Gemini image editing/gi, 'Image editing')
        .replace(/Gemini/gi, 'Image editing')
        .replace(/Firefly/gi, 'Creative generation')
        .replace(/GenStudio/gi, 'creative tools');
    }
    if (/regenerat/i.test(text) || /generation failed/i.test(text)) {
      return 'Creative generation failed';
    }
    return 'Image editing failed';
  }

  /**
   * Preview framing for assets that still need a browser-side crop. Server-adapted
   * files already match the target format exactly, so they are shown centred —
   * negative space marks the copy safe area, not a crop anchor.
   */
  function cropPositionFor(asset) {
    if (asset && asset.formatAdaptation === 'cover-crop') return 'center';
    const space = String((asset.creativeSpecification || {}).negativeSpace || '').toLowerCase();
    if (space === 'left') return 'left center';
    if (space === 'right') return 'right center';
    if (space === 'top') return 'center top';
    if (space === 'bottom') return 'center bottom';
    return 'center';
  }

  const previousDamPreview = typeof damPreview === 'function' ? damPreview : null;
  window.damPreview = function (a) {
    // Generated creatives use the same preview shell as DAM originals (clean-creative),
    // so they fill the preview slot instead of rendering as a 112x72 dam-thumb.
    if (a && a.imageUrl) {
      const label = a.derived || a.generationSource ? 'AI-modified creative' : 'Generated creative';
      return `<div class="clean-creative asset-crop-full" role="img" aria-label="${esc(a.headline || a.name || label)}" style="background-image:url('${esc(a.imageUrl)}');background-size:cover;background-position:${cropPositionFor(a)};background-repeat:no-repeat"></div>`;
    }
    if (a && (a.derived || a.matchStatus === 'AI-modified')) {
      return `<div class="genstudio-source-preview"><small>AI-ASSISTED</small><strong>${esc(a.headline || a.name)}</strong></div>`;
    }
    return previousDamPreview ? previousDamPreview(a) : '';
  };
  if (typeof damPreview !== 'undefined') damPreview = window.damPreview;

  const previousOpenGenStudioRequest =
    typeof openGenStudioRequest === 'function' ? openGenStudioRequest : null;
  window.openGenStudioRequest = function (i, mode) {
    if (mode !== 'modify') {
      if (previousOpenGenStudioRequest) return previousOpenGenStudioRequest(i, mode);
      return;
    }
    const a = state.assets[i];
    if (!a) return;
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">` +
      `<div class="modal"><h2>Modify asset</h2>` +
      `<p>Describe the visual changes you want to make to the current asset.</p>` +
      `<div class="field full"><label>MODIFICATION INSTRUCTIONS</label>` +
      `<textarea id="gsPrompt" style="min-height:160px" placeholder="Describe the changes you want to make to the current asset."></textarea></div>` +
      `<div class="modal-actions">` +
      `<button class="btn" onclick="closeModal()">Cancel</button>` +
      `<button class="btn primary" onclick="submitGenStudioAssetRequest(${i},'modify')">Apply changes</button>` +
      `</div></div></div>`;
  };
  if (typeof openGenStudioRequest !== 'undefined') {
    openGenStudioRequest = window.openGenStudioRequest;
  }

  window.regenerateFireflyDerivative = function (i) {
    const a = state.assets[i];
    if (!a) {
      toast('No asset to regenerate');
      return;
    }
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">` +
      `<div class="modal"><h2>Regenerate creative</h2>` +
      `<p>Describe the new visual you want to create for this channel.</p>` +
      `<div class="field"><label>GENERATION PROMPT</label>` +
      `<textarea id="fireflyGenerationPrompt" rows="6" placeholder="Describe the new visual you want to generate."></textarea></div>` +
      `<div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button>` +
      `<button class="btn primary" onclick="submitFireflyRegeneration(${i})">Generate creative</button></div>` +
      `</div></div>`;
  };

  window.submitFireflyRegeneration = async function (i) {
    const a = state.assets[i];
    const promptElement = document.getElementById('fireflyGenerationPrompt');
    const generationPrompt = promptElement ? promptElement.value.trim() : '';
    if (!a || !generationPrompt) {
      toast('Enter a generation prompt');
      return;
    }
    const pendingRequest = {
      title: a.headline || '',
      description: a.copy || '',
      cta: a.cta || '',
      // Modify Prompt is deliberately not reused by Firefly.
      prompt: ''
    };

    const originalSnapshot = {
      id: a.id,
      headline: a.headline,
      copy: a.copy,
      cta: a.cta,
      matchStatus: a.matchStatus,
      included: a.included,
      adapted: a.adapted,
      generated: a.generated
    };

    closeModal();
    state.damGeneratingId = a.id;
    state.damGeneratePhase = 'generating';
    state.damGenerateError = null;
    renderAll();

    const rootId = rootSourceDamIdFor(a);
    const body = {
      mode: 'modify',
      campaignBrief: campaignBriefFromState(),
      asset: {
        id: a.id,
        sourceId: rootId,
        lineage: a.lineage || 'Adobe DAM · ' + rootId,
        channel: a.channel,
        format: a.format,
        dimensions: a.dimensions,
        headline: a.headline,
        copy: a.copy,
        cta: a.cta
      },
      modification: pendingRequest,
      campaignContext: {
        businessDomain: 'corporate',
        campaignType: 'iPortal',
        channel: a.channel
      },
      sourceDamAsset: {
        id: a.id,
        imageUrl: resolveEditSourceImageUrl(a),
        mimeType: a.imageUrl && /\.jpe?g$/i.test(a.imageUrl) ? 'image/jpeg' : 'image/png'
      },
      editSourceAssetId: a.id,
      rootSourceDamAssetId: rootId,
      regenerate: true,
      inputsChanged: false,
      generationPrompt,
      existingSpecification: a.creativeSpecification,
      existingVisualReference: a.visualReference || null
    };

    try {
      const response = await fetch('/api/ai/modify-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error(payload.error || 'Regenerate failed'), {
          stage: payload.stage === 'generating' ? 'generating' : 'interpreting',
          httpStatus: response.status,
          uiMessage: payload.error || null
        });
      }

      const derived = payload.derivedAsset;
      // Only a persisted generated image may replace what the slot currently shows.
      if (!derived || !derived.id || !derived.imageUrl || DEMO_ASSET_IDS.has(derived.id)) {
        throw new Error('Creative generation failed');
      }

      const record = replaceSlotWithDerivative(a, derived);
      record.fireflyGenerationPrompt = generationPrompt;
      state.damGeneratePhase = 'ready';
      state.damGeneratingId = null;
      addActivity(`${record.requirement} · regenerated asset ${record.id}`);
      renderAll();
      toast('Creative generated');
      setTimeout(() => {
        state.damGeneratePhase = null;
        renderAll();
      }, 1200);
    } catch (error) {
      a.headline = originalSnapshot.headline;
      a.copy = originalSnapshot.copy;
      a.cta = originalSnapshot.cta;
      a.matchStatus = originalSnapshot.matchStatus;
      a.adapted = originalSnapshot.adapted;
      a.generated = originalSnapshot.generated;
      a.included = originalSnapshot.included;
      state.damGenerateError = 'Creative generation failed';
      state.damGeneratingId = null;
      state.damGeneratePhase = null;
      renderAll();
      toast(state.damGenerateError);
    }
  };

  const previousSubmit = typeof submitGenStudioAssetRequest === 'function' ? submitGenStudioAssetRequest : null;

  window.submitGenStudioAssetRequest = async function (i, mode) {
    if (mode !== 'modify') {
      if (previousSubmit) return previousSubmit(i, mode);
      return;
    }

    // Active candidate is the edit source — may be Original or an AI-modified derivative.
    const a = state.assets[i];
    if (!a) return;
    const rootId = rootSourceDamIdFor(a);

    const promptElement = document.getElementById('gsPrompt');
    const prompt = promptElement ? String(promptElement.value || '').trim() : '';
    if (!prompt) {
      toast('Enter modification instructions');
      return;
    }

    // Visual edit only: Title / Description / CTA come from the current slot, not the modal.
    const pendingRequest = {
      title: a.headline || '',
      description: a.copy || '',
      cta: a.cta || '',
      prompt
    };
    a.pendingRequest = pendingRequest;
    // Identity is recomputed from the asset now occupying the slot, so a second edit does not
    // inherit the previous edit source.
    a.genStudioContext = Object.assign({}, a.genStudioContext || {}, {
      sourceId: rootId,
      editSourceAssetId: a.id,
      rootSourceDamAssetId: rootId,
      channel: a.channel,
      format: a.format,
      dimensions: a.dimensions
    });

    // Snapshot original fields — never mutate content on failure.
    const originalSnapshot = {
      id: a.id,
      headline: a.headline,
      copy: a.copy,
      cta: a.cta,
      matchStatus: a.matchStatus,
      included: a.included,
      adapted: a.adapted,
      generated: a.generated
    };

    closeModal();
    state.damGeneratingId = a.id;
    state.damGeneratePhase = 'editing';
    state.damGenerateError = null;
    renderAll();

    const nextFp = modificationFingerprint(pendingRequest);
    const body = {
      mode: 'modify',
      campaignBrief: campaignBriefFromState(),
      asset: {
        id: a.id,
        sourceId: rootId,
        lineage: a.lineage || a.genStudioContext.lineage || 'Adobe DAM · ' + rootId,
        channel: a.channel,
        format: a.format,
        dimensions: a.dimensions,
        headline: a.headline,
        copy: a.copy,
        cta: a.cta
      },
      modification: pendingRequest,
      campaignContext: {
        businessDomain: 'corporate',
        campaignType: 'iPortal',
        channel: a.channel
      },
      sourceDamAsset: {
        id: a.id,
        imageUrl: resolveEditSourceImageUrl(a),
        mimeType: a.imageUrl && /\.jpe?g$/i.test(String(a.imageUrl)) ? 'image/jpeg' : 'image/png'
      },
      editSourceAssetId: a.id,
      rootSourceDamAssetId: rootId,
      regenerate: false,
      inputsChanged: true,
      existingSpecification: a.creativeSpecification
    };

    try {
      const response = await fetch('/api/ai/modify-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const stage = payload.stage === 'generating' ? 'generating' : 'interpreting';
        console.warn('[modify-asset] request failed', {
          httpStatus: response.status,
          stage: payload.stage || null,
          reason: payload.error || null,
          details: payload.details || null
        });
        throw Object.assign(new Error(payload.error || 'Modify failed'), {
          stage,
          httpStatus: response.status,
          uiMessage: payload.error || null
        });
      }

      if (payload.stage === 'unsupported') {
        const message = neutralizeMarketerMessage(
          payload.message || 'Image editing is not available. The current asset was left unchanged.'
        );
        state.damGeneratingId = null;
        state.damGeneratePhase = null;
        state.damGenerateError = null;
        renderAll();
        toast(message);
        return;
      }

      a.genStudioContext.lastModificationFingerprint = nextFp;

      // Copy-only is no longer offered from the Modify modal; if the server returns it,
      // keep the image and apply content only when present without exposing provider copy.
      if (payload.intent === 'update_copy_only' && payload.contentUpdate) {
        a.headline = payload.contentUpdate.headline;
        a.copy = payload.contentUpdate.copy;
        a.cta = payload.contentUpdate.cta;
        if (a.pendingRequest) {
          a.pendingRequest.title = a.headline;
          a.pendingRequest.description = a.copy;
          a.pendingRequest.cta = a.cta;
        }
        state.damGeneratePhase = 'ready';
        state.damGeneratingId = null;
        addActivity(`${a.requirement} · campaign content updated`);
        renderAll();
        toast('Campaign content updated');
        setTimeout(() => {
          state.damGeneratePhase = null;
          renderAll();
        }, 1200);
        return;
      }

      const derived = payload.derivedAsset;
      // Only a persisted generated image may replace what the slot currently shows.
      if (!derived || !derived.id || !derived.imageUrl) {
        throw new Error('Creative generation failed');
      }

      // Never auto-load historical demo ids as derivatives.
      if (DEMO_ASSET_IDS.has(derived.id)) {
        throw new Error('Invalid derived asset id');
      }

      const record = replaceSlotWithDerivative(a, derived);
      record.genStudioContext.lastModificationFingerprint = nextFp;

      state.damGeneratePhase = 'ready';
      state.damGeneratingId = null;
      addActivity(`${record.requirement} · edited asset ${record.id}`);
      renderAll();
      toast('Asset updated');
      setTimeout(() => {
        state.damGeneratePhase = null;
        renderAll();
      }, 1200);
    } catch (error) {
      // Original untouched; no half-created library entry.
      a.headline = originalSnapshot.headline;
      a.copy = originalSnapshot.copy;
      a.cta = originalSnapshot.cta;
      a.matchStatus = originalSnapshot.matchStatus;
      a.adapted = originalSnapshot.adapted;
      a.generated = originalSnapshot.generated;
      a.included = originalSnapshot.included;

      const stage = error && error.stage === 'generating' ? 'generating' : 'interpreting';
      const serverMessage = error && typeof error.uiMessage === 'string' ? error.uiMessage : '';
      const toastMessage =
        /AI service unavailable|corporate network|VPN/i.test(serverMessage)
          ? 'AI service unavailable. Check corporate network/VPN connection.'
          : neutralizeMarketerMessage(serverMessage || (stage === 'generating' ? 'Image editing failed' : 'Image editing failed'));
      console.warn('[modify-asset] ' + toastMessage, {
        stage,
        httpStatus: (error && error.httpStatus) || null,
        reason: (error && error.message) || null
      });
      state.damGenerateError = null;
      state.damGeneratingId = null;
      state.damGeneratePhase = null;
      renderAll();
      toast(toastMessage);
    }
  };
  if (typeof submitGenStudioAssetRequest !== 'undefined') {
    submitGenStudioAssetRequest = window.submitGenStudioAssetRequest;
  }

  // Enhance Asset Library rendering with AI-modified badge + regenerate + loading copy.
  const previousRenderAssets = typeof renderAssets === 'function' ? renderAssets : null;
  if (previousRenderAssets) {
    renderAssets = function () {
      const html = previousRenderAssets();
      const phase = state.damGeneratePhase;
      const busyId = state.damGeneratingId;
      let out = html;

      if (busyId && phase) {
        const a = state.assets.find((x) => x.id === busyId);
        const label = phaseLabel(phase, a && a.found);
        out = out.replace(
          /Adapting in Adobe GenStudio|Creating in Adobe GenStudio|Generating with Adobe Firefly…/g,
          label
        );
      }

      if (state.damGenerateError) {
        // Prefer toast for failures — avoid permanent large asset-card warnings.
        state.damGenerateError = null;
      }

      // Badge on AI-modified tabs / status chips already use matchStatus from the record.
      return out;
    };
  }

  // Patch active asset controls for derivatives (regenerate) via setAssetTab re-render path in v19-5.
  const previousSetAssetTab = window.setAssetTab;
  if (typeof previousSetAssetTab === 'function') {
    // no-op marker — controls updated below by wrapping renderAssets more carefully
  }

  // Override renderAssets from v19-5 with derivative-aware controls while preserving layout.
  if (typeof renderAssets === 'function' && typeof channelRank !== 'function') {
    // channelRank lives inside v19-5 IIFE — use local ranker
  }

  function localChannelRank(label) {
    const v = String(label || '').toLowerCase();
    if (v.includes('linkedin')) return 0;
    if (v.includes('email')) return 1;
    return 2;
  }

  renderAssets = function () {
    const selected = state.assets.filter((a) => a.included);
    // Every channel/format slot is one tab holding whichever asset currently occupies it.
    const ordered = state.assets
      .map((a, i) => ({ a, i }))
      .sort(
        (x, y) =>
          localChannelRank(x.a.channel) - localChannelRank(y.a.channel) ||
          String(x.a.requirement).localeCompare(String(y.a.requirement))
      );
    const valid = ordered.some((x) => x.i === state.assetTab);
    const activeIndex = valid ? state.assetTab : ordered[0] ? ordered[0].i : 0;
    state.assetTab = activeIndex;
    const a = state.assets[activeIndex];
    if (!a) return previousRenderAssets ? previousRenderAssets() : '';

    const reusable = state.assets.filter((x) => x.matchStatus === 'Reusable').length;
    const adapt = state.assets.filter((x) => x.matchStatus === 'Adaptation recommended').length;
    const gaps = state.assets.filter((x) => String(x.matchStatus).includes('No suitable')).length;
    const busy = state.generatingStage !== null || state.savingStage !== null;
    const lineage = displayLineage(a);

    const statusBadge =
      a.matchStatus === 'Reusable'
        ? 'success'
        : a.matchStatus === 'AI-modified'
          ? 'success'
          : 'warning';

    const loading = state.damGeneratingId === a.id;

    // Marketer-facing actions only — no Preview, threaded comments, or provider CTAs.
    let controls = '';
    if (a.found || a.derived || a.generated || a.adapted) {
      controls =
        `<button class="btn" onclick="openGenStudioRequest(${activeIndex},'modify')">Modify asset</button>` +
        `<button class="btn" onclick="regenerateFireflyDerivative(${activeIndex})">Regenerate creative</button>` +
        `<button class="btn" onclick="openExternalApprovalRequest('asset','${activeIndex}')">Send for agency approval</button>`;
    } else {
      controls = `<button class="btn" onclick="regenerateFireflyDerivative(${activeIndex})">Regenerate creative</button>`;
    }

    // The slot keeps its own requirement heading; generated status is shown by badges.
    const heading = a.requirement;
    // Target crop, the untouched provider output and the delivered file are three
    // different facts; show them separately so the adapted crop is never labelled
    // as the source image.
    const derivativeMeta = a.derived
      ? `<div class="v17-kv"><label>Target format</label><span>${esc(a.format)} · ${esc(a.dimensions)}</span></div><div class="v17-kv"><label>Source</label><span>AI-assisted${a.sourceDimensions ? ' · ' + esc(a.sourceDimensions) : ''}</span></div><div class="v17-kv"><label>Final asset</label><span>${esc(a.finalImageDimensions || a.dimensions || '')}</span></div><div class="v17-kv"><label>Original DAM asset</label><span>${esc((a.rootAssetSnapshot && a.rootAssetSnapshot.id) || a.rootSourceDamAssetId || a.sourceAssetId || '')}</span></div>`
      : '';
    // Generated creatives carry no DAM match recommendation.
    const recommendation = a.derived
      ? ''
      : `<div class="v17-recommendation"><strong>Recommendation:</strong> ${esc(a.matchReason)}</div>`;

    const providerBadge = a.derived
      ? `<span class="clean-badge success">AI-modified</span>`
      : '';
    const loadingDescription =
      state.damGeneratePhase === 'generating'
        ? 'Creating a new creative from the Generation Prompt.'
        : state.damGeneratePhase === 'updating_copy'
          ? 'Updating campaign content without changing the image.'
          : 'Editing the current asset image.';

    return `${stageHeader(5, 'Search Asset Library', 'Adobe DAM matching, asset adaptation and external creative review.')}<div class="clean-summary-row"><div class="clean-summary-stat"><strong>46</strong><span>DAM assets reviewed</span></div><div class="clean-summary-stat"><strong>${reusable}</strong><span>Reuse</span></div><div class="clean-summary-stat"><strong>${adapt}</strong><span>Adapt</span></div><div class="clean-summary-stat"><strong>${gaps}</strong><span>Create</span></div></div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(5)}Recommended assets</div>${renderAssetHeaderRight(5, selected.length + ' selected')}</div><div class="artifact-body"><div class="v17-tabs v19-parent-asset-tabs">${ordered
      .map(({ a: x, i }) => {
        const label = esc(
          String(x.requirement)
            .replace(/^LinkedIn sponsored content — /i, '')
            .replace(/^Email — /i, '')
        );
        return `<button class="v17-tab ${i === activeIndex ? 'active' : ''}" onclick="setAssetTab(${i})">${esc(x.channel)} · ${label}</button>`;
      })
      .join('')}</div><div class="v17-asset-layout"><div class="v17-asset-preview">${damPreview(a)}</div><div class="v17-asset-main"><h3>${esc(heading)}</h3><div class="v17-asset-meta">${esc(displaySourceLabel(a))} · ${esc(a.format)} · ${esc(a.dimensions)}</div><div class="tag-row"><span class="clean-badge ${statusBadge}">${esc(a.matchStatus)}</span><span class="clean-badge blue">${esc(a.confidence)}</span>${providerBadge}</div>${recommendation}${loading ? `<div class="genstudio-inline"><div class="genstudio-mark">AI</div><div><strong>${esc(phaseLabel(state.damGeneratePhase, a.found))} ${typeof teamsTypingDots === 'function' ? teamsTypingDots() : ''}</strong><span>${esc(loadingDescription)}</span></div></div>` : ''}<div class="v17-agency-strip">${typeof externalStatusMarkup === 'function' ? externalStatusMarkup(a) : ''}</div><label class="asset-choice"><input type="checkbox" ${a.included ? 'checked' : ''} onchange="toggleAsset(${activeIndex})"> Select for campaign</label><div class="v17-asset-controls">${controls}</div><div class="v19-expanded-label">Asset details</div><div class="v17-package-grid v19-expanded-meta"><div class="v17-kv"><label>Approval</label><span>${esc(a.approval)}</span></div><div class="v17-kv"><label>Rights / expiry</label><span>${esc(a.rights)} · ${esc(a.expiry)}</span></div><div class="v17-kv"><label>Source</label><span>${esc(displaySourceLabel(a))}</span></div><div class="v17-kv"><label>Lineage</label><span>${lineage}</span></div>${derivativeMeta}</div></div></div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn primary" ${selected.length && !busy ? '' : 'disabled'} onclick="acceptStageAsset(5,'Asset-selection package')">Accept selected assets</button></div>${renderInlineOperation(5)}</div></div>`;
  };

  window.setAssetTab = function (i) {
    state.assetTab = i;
    renderAll();
  };

  const previousAcceptStageAsset = typeof acceptStageAsset === 'function' ? acceptStageAsset : null;
  window.acceptStageAsset = function (i, label) {
    if (i === 5) {
      syncOutputsFromSelectedAssets();
    }
    if (previousAcceptStageAsset) return previousAcceptStageAsset(i, label);
  };
  if (typeof acceptStageAsset !== 'undefined') acceptStageAsset = window.acceptStageAsset;

  const previousPreviewDamAsset = typeof previewDamAsset === 'function' ? previewDamAsset : null;
  window.previewDamAsset = function (i) {
    const a = state.assets[i];
    if (!a) return;
    if (a.imageUrl) {
      document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal wide"><h2>${esc(a.name)}</h2><p>${a.derived ? 'AI-assisted creative' : 'Adobe DAM preview'} · ${esc(a.id)}</p><div class="asset-preview"><img src="${esc(a.imageUrl)}" alt="${esc(a.headline || a.name)}" style="width:100%;border-radius:10px"><div class="social-preview" style="margin-top:12px"><small>${esc(a.channel)} · ${esc(a.dimensions || '')}</small><h4>${esc(a.headline || a.requirement)}</h4><p>${esc(a.copy || a.matchReason)}</p><p style="margin-top:8px"><strong>${esc(a.cta || '')} →</strong></p></div></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button><button class="btn primary" onclick="closeModal();toggleAsset(${i})">${a.included ? 'Remove selection' : 'Select for campaign'}</button></div></div></div>`;
      return;
    }
    if (previousPreviewDamAsset) return previousPreviewDamAsset(i);
  };
  if (typeof previewDamAsset !== 'undefined') previewDamAsset = window.previewDamAsset;

  /** Image precedence for a channel output: output visual → selected asset visual → V19 creative. */
  window.resolveOutputCreative = function resolveOutputCreative(o) {
    if (o && o.imageUrl) return o.imageUrl;
    const pattern = channelPatternForOutput(o);
    const selected = pattern ? selectedAssetForChannel(pattern) : null;
    if (selected && selected.imageUrl) return selected.imageUrl;
    return window.IPORTAL_CREATIVE || '';
  };

  // Stage 7 is derived state: it is rebuilt from the accepted selection on every render, so an
  // artifact rendered before the derivative was accepted can never survive as stale markup.
  const previousRenderOutputs = typeof renderOutputs === 'function' ? renderOutputs : null;
  if (previousRenderOutputs) {
    renderOutputs = function () {
      refreshOutputsForSelectionChange();
      return stripOutputActionCtas(previousRenderOutputs());
    };
    window.renderOutputs = renderOutputs;
  }

  const previousRenderOutputPreview = typeof renderOutputPreview === 'function' ? renderOutputPreview : null;
  window.renderOutputPreview = function (o) {
    const base = previousRenderOutputPreview ? previousRenderOutputPreview(o) : '';
    const fallback = window.IPORTAL_CREATIVE || '';
    const creative = window.resolveOutputCreative(o);
    if (!base || !fallback || !creative || creative === fallback) return base;
    // The V19 output previews hard-code the supplied iPortal creative. Swap it for the
    // selected asset's visual so the existing channel markup is reused unchanged.
    return base.split(fallback).join(creative);
  };
  if (typeof renderOutputPreview !== 'undefined') renderOutputPreview = window.renderOutputPreview;

  /** Strip collaborator-generation CTAs from shared stage action renderers (UI only). */
  function stripCollaboratorGenerationCtas(html) {
    return String(html || '')
      .replace(/<button\b[^>]*>\s*Generate with collaborator comments[^<]*<\/button>/gi, '')
      .replace(/<button\b[^>]*>\s*Generate with selected collaborator comments[^<]*<\/button>/gi, '')
      .replace(
        /Use <strong>Regenerate<\/strong> for new instructions typed in the main chat\. Use <strong>Generate with collaborator comments<\/strong> only for checked review threads\./gi,
        'Use <strong>Regenerate</strong> for new instructions typed in the main chat.'
      );
  }

  /**
   * Channel-output cards keep only Edit and Accept output. The rendered creative is untouched:
   * only buttons whose visible label is exactly "Preview" are removed.
   */
  function stripOutputActionCtas(html) {
    return stripCollaboratorGenerationCtas(html).replace(/<button\b[^>]*>\s*Preview\s*<\/button>/gi, '');
  }

  if (typeof renderStandardAssetActions === 'function') {
    const previousStandard = renderStandardAssetActions;
    window.renderStandardAssetActions = function (i, acceptText, acceptJs, extra) {
      return stripCollaboratorGenerationCtas(previousStandard(i, acceptText, acceptJs, extra));
    };
    renderStandardAssetActions = window.renderStandardAssetActions;
  }
})();
