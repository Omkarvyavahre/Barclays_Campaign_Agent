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
  (state.assets || []).forEach((asset) => {
    if (!asset.selectedCandidateKind) asset.selectedCandidateKind = 'original';
    if (asset.modifiedCandidate === undefined) asset.modifiedCandidate = null;
    if (!Array.isArray(asset.generatedCandidates)) {
      asset.generatedCandidates = asset.generatedCandidate ? [asset.generatedCandidate] : [];
    }
    asset.generatedCandidate =
      asset.generatedCandidates[asset.generatedCandidates.length - 1] || null;
    if (!asset.selectedCandidateId) asset.selectedCandidateId = asset.id;
  });

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

  const CANDIDATE_KINDS = ['original', 'modified', 'generated'];
  const CANDIDATE_LABELS = {
    original: 'Original',
    modified: 'Modified',
    generated: 'Generated'
  };

  function dimensionsRatio(dimensions, fallback) {
    const match = /(\d+)\s*[×x]\s*(\d+)/i.exec(String(dimensions || ''));
    const width = match ? Number(match[1]) : fallback[0];
    const height = match ? Number(match[2]) : fallback[1];
    return width > 0 && height > 0 ? width + ' / ' + height : fallback[0] + ' / ' + fallback[1];
  }

  function ensureVariantState(slot) {
    if (!slot) return slot;
    if (!slot.selectedCandidateKind || CANDIDATE_KINDS.indexOf(slot.selectedCandidateKind) < 0) {
      slot.selectedCandidateKind = 'original';
    }
    if (slot.modifiedCandidate === undefined) slot.modifiedCandidate = null;
    if (!Array.isArray(slot.generatedCandidates)) {
      slot.generatedCandidates = slot.generatedCandidate ? [slot.generatedCandidate] : [];
    }
    // Latest-generated pointer stays in sync for legacy reads; the array is authoritative.
    slot.generatedCandidate = slot.generatedCandidates[slot.generatedCandidates.length - 1] || null;
    if (!slot.selectedCandidateId) slot.selectedCandidateId = slot.id;
    return slot;
  }

  /** Derived candidates in stack order: latest Modified first, then Generated 1..N. */
  function orderedDerivedCandidates(slot) {
    ensureVariantState(slot);
    const list = [];
    if (slot.modifiedCandidate) list.push(slot.modifiedCandidate);
    (slot.generatedCandidates || []).forEach((g) => {
      if (g) list.push(g);
    });
    return list;
  }

  /** Resolve a stack reference — a candidate id, the slot id (Original), or a kind. */
  function resolveCandidateRef(slot, ref) {
    ensureVariantState(slot);
    if (ref === slot.id || ref === 'original') return originalCandidateFromSlot(slot);
    const byId = orderedDerivedCandidates(slot).find((c) => c && c.id === ref);
    if (byId) return byId;
    if (ref === 'modified') return slot.modifiedCandidate || null;
    if (ref === 'generated') return slot.generatedCandidate || null;
    return null;
  }

  /** Original is always the root slot record — never mutated into a derivative. */
  function originalCandidateFromSlot(slot) {
    ensureVariantState(slot);
    return {
      id: slot.id,
      kind: 'original',
      label: CANDIDATE_LABELS.original,
      imageUrl: slot.imageUrl || null,
      channel: slot.channel,
      format: slot.format,
      dimensions: slot.dimensions,
      headline: slot.headline,
      copy: slot.copy,
      cta: slot.cta,
      rootSourceDamAssetId: slot.id,
      derivedFromAssetId: null,
      generationSource: null,
      createdAt: slot.modified || null,
      derived: false,
      approval: slot.approval || 'Approved source asset',
      brandGrounding: null
    };
  }

  function candidateByKind(slot, kind) {
    ensureVariantState(slot);
    if (kind === 'original') return originalCandidateFromSlot(slot);
    if (kind === 'modified') return slot.modifiedCandidate || null;
    if (kind === 'generated') return slot.generatedCandidate || null;
    return null;
  }

  /** Explicit user selection wins — resolved by candidate id, never "latest derivative". */
  function resolveSelectedCandidate(slot) {
    if (!slot) return null;
    ensureVariantState(slot);
    const selected = resolveCandidateRef(slot, slot.selectedCandidateId);
    if (selected) {
      slot.selectedCandidateKind = selected.kind;
      return selected;
    }
    slot.selectedCandidateId = slot.id;
    slot.selectedCandidateKind = 'original';
    return originalCandidateFromSlot(slot);
  }

  function visibleCandidates(slot) {
    ensureVariantState(slot);
    return [originalCandidateFromSlot(slot)].concat(orderedDerivedCandidates(slot));
  }

  /** Display label with per-kind numbering only when more than one of that kind exists. */
  function candidateStackLabels(slot) {
    const list = visibleCandidates(slot);
    const counts = {};
    list.forEach((c) => {
      counts[c.kind] = (counts[c.kind] || 0) + 1;
    });
    const seen = {};
    return list.map((c) => {
      seen[c.kind] = (seen[c.kind] || 0) + 1;
      const base = CANDIDATE_LABELS[c.kind] || 'Candidate';
      const label = counts[c.kind] > 1 && c.kind !== 'original' ? base + ' ' + seen[c.kind] : base;
      return { candidate: c, label };
    });
  }

  /**
   * The selected candidate for a channel output. Each included slot contributes its
   * explicitly selected Original / Modified / Generated candidate — never an inferred
   * "latest derivative".
   */
  function selectedAssetForChannel(channelPattern) {
    const selected = (state.assets || []).filter(
      (a) => a.included && channelPattern.test(String(a.channel))
    );
    const withVariant = selected.find((a) => {
      ensureVariantState(a);
      return a.selectedCandidateId && a.selectedCandidateId !== a.id;
    });
    const slot = withVariant || selected[0] || null;
    return slot ? resolveSelectedCandidate(slot) : null;
  }

  /**
   * Campaign content for a slot. The prompt-only modals no longer collect Title/Description/CTA,
   * and an unfilled requirement slot carries none of its own, so it falls back to the channel
   * output and then the campaign brief rather than sending empty strings.
   */
  function campaignContentForAsset(asset) {
    const channel = String((asset && asset.channel) || '');
    const output = Object.values(state.outputs || {}).find((o) =>
      channel ? new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(String(o.channel)) : false
    );
    const brief = campaignBriefFromState();
    return {
      title: (asset && asset.headline) || (output && output.headline) || brief.proposition,
      description:
        (asset && asset.copy) ||
        (output && output.body) ||
        (asset && asset.requirement) ||
        brief.objective ||
        brief.campaignName,
      cta: (asset && asset.cta) || (output && output.cta) || 'Learn more'
    };
  }

  function channelPatternForOutput(output) {
    const channel = String((output && output.channel) || '');
    if (/email/i.test(channel)) return /email/i;
    if (/linkedin/i.test(channel)) return /linkedin/i;
    return null;
  }

  /**
   * Clear transient creative fields when a channel has no included selected asset.
   * Keeps the output shell (label/channel/format/audience/tracking/etc.) so the card
   * still renders, but Stage 7 must show the explicit empty creative state.
   */
  function clearOutputCreative(output) {
    if (!output) return;
    delete output.assetId;
    delete output.imageUrl;
    delete output.brandGrounding;
    delete output.logoComposition;
    delete output.brandStatus;
    delete output.generated;
    delete output.generationSource;
    delete output.derivedFromAssetId;
    output.sourceAssetIds = [];
    if (output.approved) {
      output.approved = false;
      delete state.acceptedAssets[6];
      state.completed.delete(6);
    }
  }

  /** Root Stage 6 slot that owns a candidate — used to surface format identity on Stage 7. */
  function slotForCandidate(candidate) {
    if (!candidate) return null;
    const rootId =
      candidate.rootSourceDamAssetId ||
      (candidate.kind === 'original' ? candidate.id : null) ||
      candidate.derivedFromAssetId ||
      null;
    if (!rootId) return null;
    return (state.assets || []).find((a) => a.id === rootId) || null;
  }

  /** Copy the selected candidate's identity, content and visual onto its channel output. */
  function applyOutputFromAsset(output, asset) {
    if (!output) return;
    if (!asset) {
      clearOutputCreative(output);
      return;
    }
    // A different accepted candidate makes an already-accepted output stale: it returns to draft.
    if (output.assetId && output.assetId !== asset.id && output.approved) {
      output.approved = false;
      delete state.acceptedAssets[6];
      state.completed.delete(6);
    }
    output.headline = asset.headline || output.headline;
    output.body = asset.copy || output.body;
    output.cta = asset.cta || output.cta;
    // Candidate id is authoritative; root DAM identity stays lineage only.
    output.assetId = asset.id;
    output.sourceAssetIds = [asset.id];
    output.generated = Boolean(asset.derived || asset.kind === 'modified' || asset.kind === 'generated');
    output.generationSource = asset.generationSource || null;
    output.derivedFromAssetId =
      asset.rootSourceDamAssetId ||
      asset.derivedFromAssetId ||
      asset.sourceAssetId ||
      asset.sourceId ||
      null;
    if (asset.kind === 'original') {
      output.derivedFromAssetId = null;
      output.generated = false;
      output.generationSource = null;
    }
    if (asset.imageUrl) output.imageUrl = asset.imageUrl;
    else delete output.imageUrl;

    // Surface the Stage 6 slot format on the Stage 7 package so LinkedIn mobile vs web
    // is explicit when a single LinkedIn output is in use.
    const slot = slotForCandidate(asset);
    if (slot) {
      if (slot.requirement) output.label = slot.requirement;
      if (slot.format) output.format = slot.format;
      if (slot.dimensions) output.dimensions = slot.dimensions;
    }

    if (asset.kind === 'original') {
      output.brandStatus = 'Approved source asset';
      delete output.brandGrounding;
      delete output.logoComposition;
    } else if (asset.brandGrounding && asset.brandGrounding.applied) {
      output.brandStatus = 'Brand guidance applied';
      output.brandGrounding = {
        applied: true,
        ruleCount: asset.brandGrounding.ruleCount || 0,
        sources: (asset.brandGrounding.sources || []).slice(0, 4)
      };
      if (asset.logoComposition && asset.logoComposition.applied) {
        output.logoComposition = {
          applied: true,
          entryId: asset.logoComposition.entryId || null,
          sourceFile: asset.logoComposition.sourceFile || null,
          placement: asset.logoComposition.placement || null
        };
      } else {
        delete output.logoComposition;
      }
    } else {
      delete output.brandStatus;
      delete output.brandGrounding;
      delete output.logoComposition;
    }
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
      .map((a) => {
        const candidate = resolveSelectedCandidate(a);
        return (
          a.id +
          '>' +
          ((candidate && candidate.id) || '') +
          '@' +
          ((candidate && candidate.imageUrl) || '')
        );
      })
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
      const asset = state.assets[i];
      if (!asset) return;
      if (typeof archiveDownstream === 'function') {
        archiveDownstream(5, 'Asset selection changed');
      }
      asset.included = !asset.included;
      // Stage 7 has a single LinkedIn package. Keep LinkedIn inclusion deterministic:
      // at most one LinkedIn slot may be selected for the campaign at a time.
      if (asset.included && /linkedin/i.test(String(asset.channel || ''))) {
        let released = false;
        (state.assets || []).forEach((other, j) => {
          if (j === i) return;
          if (/linkedin/i.test(String(other.channel || '')) && other.included) {
            other.included = false;
            released = true;
          }
        });
        if (released && typeof toast === 'function') {
          toast('Only one LinkedIn format can be selected for Stage 7 at a time');
        }
      }
      syncOutputsFromSelectedAssets();
      if (typeof addActivity === 'function') {
        addActivity(`${asset.requirement} ${asset.included ? 'selected' : 'excluded'}`);
      }
      renderAll();
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

  /**
   * Visual used as the Gemini edit source: the currently selected candidate's image.
   * A slot with no creative has nothing to edit, so it must not inherit another channel's asset.
   */
  function resolveEditSourceImageUrl(asset) {
    if (!asset) return undefined;
    const candidate = resolveSelectedCandidate(asset);
    if (candidate && candidate.imageUrl) return candidate.imageUrl;
    if (asset.imageUrl) return asset.imageUrl;
    return undefined;
  }

  function resolveEditSourceAssetId(asset) {
    if (!asset) return null;
    const candidate = resolveSelectedCandidate(asset);
    return (candidate && candidate.id) || asset.id;
  }

  function rootSourceDamIdFor(asset) {
    if (!asset) return null;
    return asset.rootSourceDamAssetId || asset.id;
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
      // Display-only metadata can wait for the next normal render. Repainting the entire
      // conversation from an image onload causes a visible flash and can disturb scroll.
    };
    probe.src = record.imageUrl;
  }

  /**
   * Add a Modified or Generated candidate under the root slot. The Original record is
   * never mutated. Repeated Modify replaces the single Modified candidate; every Generate
   * appends a new Generated candidate (Generated 1..N) so prior generations are preserved.
   */
  function upsertVariantCandidate(slot, derived, kind) {
    ensureVariantState(slot);
    const editSourceAssetId = derived.editSourceAssetId || resolveEditSourceAssetId(slot);
    const rootSourceDamAssetId =
      derived.rootSourceDamAssetId || rootSourceDamIdFor(slot) || slot.id;
    if (!slot.rootAssetSnapshot) slot.rootAssetSnapshot = snapshotRootAsset(slot);

    const candidate = {
      id: derived.id,
      kind,
      label: CANDIDATE_LABELS[kind],
      imageUrl: derived.imageUrl,
      channel: slot.channel,
      format: slot.format,
      dimensions: slot.dimensions,
      // Visual-only actions keep campaign copy on the slot / candidate content.
      headline: slot.headline,
      copy: slot.copy,
      cta: slot.cta,
      rootSourceDamAssetId,
      derivedFromAssetId: derived.derivedFromAssetId || editSourceAssetId,
      generationSource: derived.generationSource,
      createdAt: new Date().toISOString(),
      derived: true,
      name: derived.name,
      sourceType: derived.sourceType,
      approval: derived.approval || 'Campaign creative draft',
      matchStatus: derived.matchStatus || 'AI-modified',
      confidence: derived.confidence || 'Campaign-ready draft',
      lineage: derived.lineage,
      jobId: derived.jobId,
      creativeSpecification: derived.creativeSpecification,
      visualFamily: derived.visualFamily,
      referenceSource: derived.referenceSource,
      sourceDimensions: derived.sourceImageDimensions || undefined,
      sourceImageUrl: derived.sourceImageUrl,
      sourceImageId: derived.sourceImageId,
      targetDimensions: derived.targetDimensions,
      finalImageDimensions: derived.finalImageDimensions,
      formatAdaptation: derived.formatAdaptation,
      brandGrounding: derived.brandGrounding || null,
      logoComposition: derived.logoComposition || null,
      generationFamilyId: derived.generationFamilyId || null,
      masterGeneratedAssetId: derived.masterGeneratedAssetId || null,
      derivedFromMasterGeneratedAssetId: derived.derivedFromMasterGeneratedAssetId || null,
      editSourceAssetId
    };

    if (kind === 'modified') {
      slot.modifiedCandidate = candidate;
    } else if (kind === 'generated') {
      slot.generatedCandidates = (slot.generatedCandidates || []).concat([candidate]);
      slot.generatedCandidate = candidate;
    } else {
      throw new Error('upsertVariantCandidate: kind must be modified or generated');
    }

    // New candidate becomes the stack selection, but campaign inclusion is left untouched.
    slot.selectedCandidateId = candidate.id;
    slot.selectedCandidateKind = kind;
    slot.version = (slot.version || 1) + 1;
    slot.genStudioContext = Object.assign({}, slot.genStudioContext || {}, {
      sourceId: rootSourceDamAssetId,
      editSourceAssetId,
      rootSourceDamAssetId,
      lastModificationFingerprint: modificationFingerprint(slot.pendingRequest || {})
    });
    slot.derivativeHistory = (slot.derivativeHistory || []).concat([
      {
        id: derived.id,
        kind,
        editSourceAssetId,
        derivedFromAssetId: candidate.derivedFromAssetId,
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

    probeGeneratedSourceDimensions(candidate);
    if (slot.included) syncOutputsFromSelectedAssets();
    return candidate;
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
    ensureVariantState(asset);
    if (asset.selectedCandidateKind === 'modified' || asset.modifiedCandidate) {
      // Slot-level label stays channel/DAM oriented; candidate rows carry Original/Modified/Generated.
      return asset.sourceType === 'Requirement' ? 'Adobe DAM search' : asset.sourceType || 'Adobe DAM';
    }
    if (asset.sourceType === 'Requirement') return 'Adobe DAM search';
    return asset.sourceType || 'Adobe DAM';
  }

  /** Neutralize provider names in lineage for display only. Internal lineage is unchanged. */
  function displayLineage(asset) {
    const candidate = asset ? resolveSelectedCandidate(asset) : null;
    const raw = String(
      (candidate && candidate.lineage) || (asset && asset.lineage ? asset.lineage : '')
    );
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
    // Prefer the selected candidate visual when rendering a slot thumbnail.
    const candidate = a && (a.kind || a.selectedCandidateKind) ? a : null;
    const imageUrl =
      (candidate && candidate.imageUrl) ||
      (a && resolveSelectedCandidate(a) && resolveSelectedCandidate(a).imageUrl) ||
      (a && a.imageUrl);
    if (imageUrl) {
      const label =
        (candidate && candidate.label) ||
        (a && CANDIDATE_LABELS[a.selectedCandidateKind]) ||
        'Creative';
      return `<div class="clean-creative asset-crop-full" role="img" aria-label="${esc(a.headline || a.name || label)}" style="--v19-creative-ratio:${dimensionsRatio(a.dimensions, [4, 3])};background-image:url('${esc(imageUrl)}');background-size:cover;background-position:${cropPositionFor(a)};background-repeat:no-repeat"></div>`;
    }
    return previousDamPreview ? previousDamPreview(a) : '';
  };
  if (typeof damPreview !== 'undefined') damPreview = window.damPreview;

  /** Truthful brand-status line for a candidate — never invents a compliance check. */
  function candidateBrandStatus(candidate) {
    if (!candidate) return '';
    if (candidate.kind === 'original') {
      return `<span class="v19-brand-status is-source">Approved source asset</span>`;
    }
    const parts = [];
    const grounding = candidate.brandGrounding;
    if (grounding && grounding.applied) {
      const ruleCount = grounding.ruleCount || 0;
      const sources = (grounding.sources || []).slice(0, 3).map((s) => esc(s)).join(', ');
      parts.push(
        ruleCount > 0
          ? `<details class="v19-brand-guidance-details"><summary>Brand guidance applied ✓</summary>` +
            `<div class="v19-brand-guidance-body"><p>${ruleCount} applicable rule${ruleCount === 1 ? '' : 's'}</p>` +
            (sources ? `<p><strong>Sources</strong><br>${sources}</p>` : '') +
            `</div></details>`
          : `<span class="v19-brand-status is-grounded">Brand guidance applied ✓</span>`
      );
    }
    if (candidate.logoComposition && candidate.logoComposition.applied) {
      parts.push(`<span class="v19-brand-status is-logo">Approved logo applied ✓</span>`);
    }
    return parts.join('');
  }

  function candidateThumb(candidate) {
    const ratio = dimensionsRatio(candidate && candidate.dimensions, [4, 3]);
    if (candidate && candidate.imageUrl) {
      return `<div class="v19-variant-thumb" role="img" aria-label="${esc(candidate.label)}" style="--v19-creative-ratio:${ratio};background-image:url('${esc(candidate.imageUrl)}')"></div>`;
    }
    return `<div class="v19-variant-thumb is-missing" aria-label="${esc(candidate && candidate.label)}" style="--v19-creative-ratio:${ratio}"></div>`;
  }

  function renderVariantStack(slot, slotIndex) {
    ensureVariantState(slot);
    resolveSelectedCandidate(slot);
    return `<div class="v19-variant-stack" role="radiogroup" aria-label="Creative variants">${candidateStackLabels(slot)
      .map(({ candidate, label }) => {
        const selected = slot.selectedCandidateId === candidate.id;
        const meta = [candidate.dimensions, candidate.format].filter(Boolean).join(' · ');
        return (
          `<div class="v19-variant-row ${selected ? 'is-selected' : ''}" data-kind="${esc(candidate.kind)}" data-candidate-id="${esc(candidate.id)}">` +
          `<label class="v19-variant-choice">` +
          `<input type="checkbox" ${selected ? 'checked' : ''} onchange="selectAssetCandidate(${slotIndex},'${esc(candidate.id)}')" aria-label="${esc(label)}">` +
          `<span class="v19-variant-label">${esc(label)}</span>` +
          `</label>` +
          `<div class="v19-variant-body">` +
          candidateThumb(candidate) +
          `<div class="v19-variant-meta"><strong>${esc(label)}</strong><span>${esc(meta)}</span>${candidateBrandStatus(candidate)}</div>` +
          `<button type="button" class="btn" onclick="previewAssetCandidate(${slotIndex},'${esc(candidate.id)}')">Preview</button>` +
          `</div></div>`
        );
      })
      .join('')}</div>`;
  }

  /**
   * Radio-like selection within a channel stack — exactly one candidate is active.
   * Accepts a candidate id (preferred) or a kind ('original'/'modified'/'generated').
   * Candidate selection is independent from campaign inclusion.
   */
  window.selectAssetCandidate = function selectAssetCandidate(slotIndex, ref) {
    const slot = state.assets[slotIndex];
    if (!slot) return;
    ensureVariantState(slot);
    const candidate = resolveCandidateRef(slot, ref);
    if (!candidate) return;
    slot.selectedCandidateId = candidate.id;
    slot.selectedCandidateKind = candidate.kind;
    if (slot.included) syncOutputsFromSelectedAssets();
    renderAll();
  };

  window.previewAssetCandidate = function previewAssetCandidate(slotIndex, ref) {
    const slot = state.assets[slotIndex];
    const candidate = slot && resolveCandidateRef(slot, ref);
    if (!candidate) return;
    const label = candidate.label || CANDIDATE_LABELS[candidate.kind] || 'Creative';
    const ratio = dimensionsRatio(candidate.dimensions || slot.dimensions, [4, 3]);
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">` +
      `<div class="modal wide v19-candidate-preview-modal" role="dialog" aria-label="${esc(label)} preview" style="--v19-preview-ratio:${ratio}">` +
      `<h2>${esc(label)}</h2>` +
      `<p>${esc(slot.channel)} · ${esc(slot.format || '')}${candidate.dimensions ? ' · ' + esc(candidate.dimensions) : ''}</p>` +
      (candidate.imageUrl
        ? `<div class="v19-candidate-preview-frame"><img src="${esc(candidate.imageUrl)}" alt="${esc(candidate.headline || label)}"></div>`
        : `<div class="v19-candidate-preview-frame is-empty"><span>No creative available for this candidate.</span></div>`) +
      `<div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>` +
      `</div></div>`;
  };

  const previousOpenGenStudioRequest =
    typeof openGenStudioRequest === 'function' ? openGenStudioRequest : null;
  window.openGenStudioRequest = function (i, mode) {
    if (mode !== 'modify') {
      if (previousOpenGenStudioRequest) return previousOpenGenStudioRequest(i, mode);
      return;
    }
    const a = state.assets[i];
    if (!a) return;
    if (!resolveEditSourceImageUrl(a)) {
      toast('This slot has no creative to modify — use Add new creative');
      return;
    }
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
      toast('No asset selected for this channel');
      return;
    }
    const channelLabel = [a.channel, a.format].filter(Boolean).join(' · ');
    document.getElementById('modalRoot').innerHTML =
      `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()">` +
      `<div class="modal"><h2>Add new creative</h2>` +
      `<p>Describe the new visual you want to create${channelLabel ? ' for ' + esc(channelLabel) : ' for this channel'}.</p>` +
      `<div class="field"><label>GENERATION PROMPT</label>` +
      `<textarea id="fireflyGenerationPrompt" rows="6" placeholder="Describe the new visual you want to generate."></textarea></div>` +
      `<div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button>` +
      `<button class="btn primary" onclick="submitFireflyRegeneration(${i})">Add new creative</button></div>` +
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
    const content = campaignContentForAsset(a);
    const pendingRequest = {
      title: content.title,
      description: content.description,
      cta: content.cta,
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
    const editSourceId = resolveEditSourceAssetId(a);
    // Campaign-level generation: one Firefly call, then local derivatives for every Stage 6 slot.
    const channelTargets = (state.assets || []).map((slot) => ({
      rootSourceDamAssetId: rootSourceDamIdFor(slot),
      channel: slot.channel,
      format: slot.format,
      dimensions: slot.dimensions,
      headline: slot.headline,
      copy: slot.copy,
      cta: slot.cta
    }));
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
        id: editSourceId,
        imageUrl: resolveEditSourceImageUrl(a),
        mimeType: a.imageUrl && /\.jpe?g$/i.test(a.imageUrl) ? 'image/jpeg' : 'image/png'
      },
      editSourceAssetId: editSourceId,
      rootSourceDamAssetId: rootId,
      regenerate: true,
      inputsChanged: false,
      generationPrompt,
      channelTargets,
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

      const hasChannelFamily =
        Array.isArray(payload.channelDerivatives) && payload.channelDerivatives.length > 0;
      const derivatives = hasChannelFamily
        ? payload.channelDerivatives
        : payload.derivedAsset
          ? [payload.derivedAsset]
          : [];
      const usable = derivatives.filter(
        (d) => d && d.id && d.imageUrl && !DEMO_ASSET_IDS.has(d.id)
      );
      if (!usable.length) {
        throw new Error('Creative generation failed');
      }

      let created = 0;
      usable.forEach((derived) => {
        let slot = a;
        if (hasChannelFamily) {
          const rootId = derived.rootSourceDamAssetId || derived.sourceId || null;
          slot =
            (rootId &&
              (state.assets || []).find((s) => rootSourceDamIdFor(s) === rootId)) ||
            null;
        }
        if (!slot) return;
        // Never auto-include; upsert selects the new Generated candidate within the tab only.
        upsertVariantCandidate(slot, derived, 'generated');
        slot.fireflyGenerationPrompt = generationPrompt;
        created += 1;
      });

      if (!created) {
        throw new Error('Creative generation failed');
      }

      const failures = Array.isArray(payload.channelDerivativeFailures)
        ? payload.channelDerivativeFailures
        : [];
      state.damGeneratePhase = 'ready';
      state.damGeneratingId = null;
      addActivity(
        `Add new creative · ${created} channel candidate${created === 1 ? '' : 's'}` +
          (payload.generationFamilyId ? ` · ${payload.generationFamilyId}` : '')
      );
      renderAll();
      if (failures.length) {
        toast(
          `Creative generated for ${created} channel${created === 1 ? '' : 's'}; ` +
            `${failures.length} format adaptation${failures.length === 1 ? '' : 's'} failed`
        );
      } else {
        toast('Creative generated across channels');
      }
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

    // Active candidate is the edit source — may be Original, Modified, or Generated.
    const a = state.assets[i];
    if (!a) return;
    ensureVariantState(a);
    const rootId = rootSourceDamIdFor(a);
    const editSourceId = resolveEditSourceAssetId(a);

    const promptElement = document.getElementById('gsPrompt');
    const prompt = promptElement ? String(promptElement.value || '').trim() : '';
    if (!prompt) {
      toast('Enter modification instructions');
      return;
    }

    // Visual edit only: Title / Description / CTA come from campaign state, not the modal.
    const editContent = campaignContentForAsset(a);
    const pendingRequest = {
      title: editContent.title,
      description: editContent.description,
      cta: editContent.cta,
      prompt
    };
    a.pendingRequest = pendingRequest;
    a.genStudioContext = Object.assign({}, a.genStudioContext || {}, {
      sourceId: rootId,
      editSourceAssetId: editSourceId,
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
      generated: a.generated,
      selectedCandidateKind: a.selectedCandidateKind,
      selectedCandidateId: a.selectedCandidateId,
      modifiedCandidate: a.modifiedCandidate,
      generatedCandidate: a.generatedCandidate,
      generatedCandidates: (a.generatedCandidates || []).slice()
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
        id: editSourceId,
        imageUrl: resolveEditSourceImageUrl(a),
        mimeType: a.imageUrl && /\.jpe?g$/i.test(String(a.imageUrl)) ? 'image/jpeg' : 'image/png'
      },
      editSourceAssetId: editSourceId,
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
      // Only a persisted generated image may create/replace the Modified candidate.
      if (!derived || !derived.id || !derived.imageUrl) {
        throw new Error('Creative generation failed');
      }

      // Never auto-load historical demo ids as derivatives.
      if (DEMO_ASSET_IDS.has(derived.id)) {
        throw new Error('Invalid derived asset id');
      }

      const record = upsertVariantCandidate(a, derived, 'modified');
      a.genStudioContext.lastModificationFingerprint = nextFp;

      state.damGeneratePhase = 'ready';
      state.damGeneratingId = null;
      addActivity(`${a.requirement} · edited asset ${record.id}`);
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
      a.selectedCandidateKind = originalSnapshot.selectedCandidateKind;
      a.selectedCandidateId = originalSnapshot.selectedCandidateId;
      a.modifiedCandidate = originalSnapshot.modifiedCandidate;
      a.generatedCandidate = originalSnapshot.generatedCandidate;
      a.generatedCandidates = originalSnapshot.generatedCandidates;

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
    // Every channel/format slot is one tab; variants stack inside the active tab.
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
    ensureVariantState(a);
    const activeCandidate = resolveSelectedCandidate(a);

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

    // Channel-level actions only — Preview lives on each candidate row and generation
    // (Add new creative) lives in the bottom action bar for the active channel tab.
    let controls = '';
    if (resolveEditSourceImageUrl(a)) {
      controls =
        `<button class="btn" ${loading ? 'disabled' : ''} onclick="openGenStudioRequest(${activeIndex},'modify')">Modify asset</button>` +
        `<button class="btn" ${loading ? 'disabled' : ''} onclick="openExternalApprovalRequest('asset','${activeIndex}')">Send for agency approval</button>`;
    }

    const hasDerivedCandidates = !!(
      a.modifiedCandidate ||
      (a.generatedCandidates && a.generatedCandidates.length)
    );
    const heading = a.requirement;
    const recommendation = hasDerivedCandidates
      ? ''
      : `<div class="v17-recommendation"><strong>Recommendation:</strong> ${esc(a.matchReason)}</div>`;

    const loadingDescription =
      state.damGeneratePhase === 'generating'
        ? 'Creating a new creative from the Generation Prompt.'
        : state.damGeneratePhase === 'updating_copy'
          ? 'Updating campaign content without changing the image.'
          : 'Editing the current asset image.';

    const selectedMeta =
      activeCandidate && activeCandidate.kind !== 'original'
        ? `<div class="v17-kv"><label>Selected candidate</label><span>${esc(activeCandidate.label)} · ${esc(activeCandidate.id)}</span></div>` +
          `<div class="v17-kv"><label>Target format</label><span>${esc(a.format)} · ${esc(a.dimensions)}</span></div>` +
          `<div class="v17-kv"><label>Source</label><span>AI-assisted${activeCandidate.sourceDimensions ? ' · ' + esc(activeCandidate.sourceDimensions) : ''}</span></div>` +
          `<div class="v17-kv"><label>Final asset</label><span>${esc(activeCandidate.finalImageDimensions || a.dimensions || '')}</span></div>` +
          `<div class="v17-kv"><label>Original DAM asset</label><span>${esc(a.id)}</span></div>` +
          (activeCandidate.brandGrounding && activeCandidate.brandGrounding.applied
            ? `<div class="v17-kv"><label>Brand guidance</label><span>${activeCandidate.brandGrounding.ruleCount || 0} applicable rules` +
              ((activeCandidate.brandGrounding.sources || []).length
                ? ` · ${(activeCandidate.brandGrounding.sources || []).slice(0, 3).map((s) => esc(s)).join(', ')}`
                : '') +
              `</span></div>`
            : '')
        : '';

    const brandStatusLabel =
      activeCandidate && activeCandidate.kind !== 'original'
        ? activeCandidate.brandGrounding && activeCandidate.brandGrounding.applied
          ? 'Brand guidance applied'
          : 'Campaign creative draft'
        : a.approval || 'Approved source asset';

    return `${stageHeader(5, 'Search Asset Library', 'Adobe DAM matching, asset adaptation and external creative review.')}<div class="clean-summary-row"><div class="clean-summary-stat"><strong>46</strong><span>DAM assets reviewed</span></div><div class="clean-summary-stat"><strong>${reusable}</strong><span>Reuse</span></div><div class="clean-summary-stat"><strong>${adapt}</strong><span>Adapt</span></div><div class="clean-summary-stat"><strong>${gaps}</strong><span>Create</span></div></div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(5)}Recommended assets</div>${renderAssetHeaderRight(5, selected.length + ' selected')}</div><div class="artifact-body"><div class="v17-tabs v19-parent-asset-tabs">${ordered
      .map(({ a: x, i }) => {
        const label = esc(
          String(x.requirement)
            .replace(/^LinkedIn sponsored content — /i, '')
            .replace(/^Email — /i, '')
        );
        return `<button class="v17-tab ${i === activeIndex ? 'active' : ''}" onclick="setAssetTab(${i})">${esc(x.channel)} · ${label}</button>`;
      })
      .join('')}</div><div class="v19-asset-variant-panel"><div class="v19-asset-variant-head"><h3>${esc(heading)}</h3><div class="v17-asset-meta">${esc(displaySourceLabel(a))} · ${esc(a.format)} · ${esc(a.dimensions)}</div><div class="tag-row"><span class="clean-badge ${statusBadge}">${esc(a.matchStatus)}</span><span class="clean-badge blue">${esc(a.confidence)}</span></div>${recommendation}</div>${renderVariantStack(a, activeIndex)}<div class="v19-operation-slot" aria-live="polite">${loading ? `<div class="genstudio-inline"><div class="genstudio-mark">AI</div><div><strong>${esc(phaseLabel(state.damGeneratePhase, a.found))} ${typeof teamsTypingDots === 'function' ? teamsTypingDots() : ''}</strong><span>${esc(loadingDescription)}</span></div></div>` : ''}</div><div class="v17-agency-strip">${typeof externalStatusMarkup === 'function' ? externalStatusMarkup(a) : ''}</div><label class="asset-choice"><input type="checkbox" ${a.included ? 'checked' : ''} onchange="toggleAsset(${activeIndex})"> Select for campaign</label><div class="v17-asset-controls">${controls}</div><div class="v19-expanded-label">Asset details</div><div class="v17-package-grid v19-expanded-meta"><div class="v17-kv"><label>Brand status</label><span>${esc(brandStatusLabel)}</span></div><div class="v17-kv"><label>Rights / expiry</label><span>${esc(a.rights)} · ${esc(a.expiry)}</span></div><div class="v17-kv"><label>Source</label><span>${esc(displaySourceLabel(a))}</span></div><div class="v17-kv"><label>Lineage</label><span>${lineage}</span></div>${selectedMeta}</div></div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" ${loading || busy ? 'disabled' : ''} onclick="regenerateFireflyDerivative(${activeIndex})">Add new creative</button><button class="btn primary" ${selected.length && !busy ? '' : 'disabled'} onclick="acceptStageAsset(5,'Asset-selection package')">Accept selected assets</button></div>${renderInlineOperation(5)}</div></div>`;
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
      const ratio = dimensionsRatio(a.dimensions, [4, 3]);
      document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal wide v19-candidate-preview-modal" style="--v19-preview-ratio:${ratio}"><h2>${esc(a.name)}</h2><p>${a.derived ? 'AI-assisted creative' : 'Adobe DAM preview'} · ${esc(a.id)}</p><div class="v19-candidate-preview-frame"><img src="${esc(a.imageUrl)}" alt="${esc(a.headline || a.name)}"></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button><button class="btn primary" onclick="closeModal();toggleAsset(${i})">${a.included ? 'Remove selection' : 'Select for campaign'}</button></div></div></div>`;
      return;
    }
    if (previousPreviewDamAsset) return previousPreviewDamAsset(i);
  };
  if (typeof previewDamAsset !== 'undefined') previewDamAsset = window.previewDamAsset;

  /**
   * Image precedence for a channel output: output visual → selected asset visual.
   * There is no global stand-in: a channel with no creative shows none.
   */
  window.resolveOutputCreative = function resolveOutputCreative(o) {
    if (o && o.imageUrl) return o.imageUrl;
    const pattern = channelPatternForOutput(o);
    const selected = pattern ? selectedAssetForChannel(pattern) : null;
    if (selected && selected.imageUrl) return selected.imageUrl;
    return '';
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

  const previousRenderOutputCard = typeof renderOutputCard === 'function' ? renderOutputCard : null;
  if (previousRenderOutputCard) {
    renderOutputCard = function (key, o) {
      const html = previousRenderOutputCard(key, o);
      if (!o) return html;
      const chips = [];
      if (o.brandStatus === 'Brand guidance applied') {
        chips.push(`<span class="v19-output-brand-status">Brand guidance applied ✓</span>`);
      } else if (o.brandStatus) {
        chips.push(`<span class="v19-output-brand-status is-source">${esc(o.brandStatus)}</span>`);
      }
      if (o.logoComposition && o.logoComposition.applied) {
        chips.push(`<span class="v19-output-brand-status is-logo">Approved logo applied ✓</span>`);
      }
      if (!chips.length) return html;
      const chipHtml = chips.join('');
      // Insert after the channel meta line when present; otherwise append.
      if (html.includes('</span></div><div style="margin-top:9px">')) {
        return html.replace(
          '</span></div><div style="margin-top:9px">',
          `</span>${chipHtml}</div><div style="margin-top:9px">`
        );
      }
      return html + chipHtml;
    };
    window.renderOutputCard = renderOutputCard;
  }

  /**
   * A channel with no selected creative gets a named empty state rather than an image
   * box with no image: substituting an empty URL leaves a silent blank band that reads
   * as a broken render. No stand-in creative is shown.
   */
  function markEmptyOutputCreative(html) {
    return String(html).replace(
      /<div class="([^"]*creative[^"]*)" style="([^"]*background-image:url\('\s*'\)[^"]*)"><\/div>/g,
      (match, className, style) =>
        `<div class="${className} is-empty" style="${String(style).replace(/background-image:url\('\s*'\);?/, '')}"><span>No creative selected for this channel. ` +
        `Choose an asset in Search Asset Library.</span></div>`
    );
  }

  const previousRenderOutputPreview = typeof renderOutputPreview === 'function' ? renderOutputPreview : null;
  window.renderOutputPreview = function (o) {
    const base = previousRenderOutputPreview ? previousRenderOutputPreview(o) : '';
    const fallback = window.IPORTAL_CREATIVE || '';
    const creative = window.resolveOutputCreative(o);
    const ratio = dimensionsRatio(o && o.dimensions, o && /email/i.test(o.channel) ? [1200, 480] : [1200, 627]);
    const withRatio = String(base).replace(
      /class="(v17-(?:li|email)-creative[^"]*)"/,
      `class="$1" style="--v19-output-ratio:${ratio}"`
    ).replace(
      /style="--v19-output-ratio:([^"]+)" style="/,
      'style="--v19-output-ratio:$1;'
    );
    if (!withRatio) return withRatio;
    if (!creative) return markEmptyOutputCreative(fallback ? withRatio.split(fallback).join('') : withRatio);
    if (!fallback || creative === fallback) return withRatio;
    // The V19 output previews hard-code the supplied iPortal creative. Swap it for the
    // selected asset's visual so the existing channel markup is reused unchanged.
    return withRatio.split(fallback).join(creative);
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
