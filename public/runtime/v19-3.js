
(function(){
  'use strict';

  const STAGE_AGENTS={
    0:{name:'Campaign Coordinator',sub:'Source grounding and workflow orchestration'},
    1:{name:'Marketing Strategy & Campaign Brief Agent',sub:'Commercial strategy and campaign brief'},
    2:{name:'Audience & Segmentation Agent',sub:'Adobe Real-Time CDP audience discovery and eligibility'},
    3:{name:'Campaign Governance Agent',sub:'Human governance and Adobe Workfront routing'},
    4:{name:'Production Planning Agent',sub:'Channel work packages, owners and Workfront tasks'},
    5:{name:'Asset Intelligence Agent',sub:'Adobe DAM matching, GenStudio adaptation and agency review'},
    6:{name:'Channel Content Agent',sub:'Adobe GenStudio channel executions and acceptance'},
    7:{name:'Launch Readiness Agent',sub:'Readiness, destination handoff and launch controls'}
  };
  function stageAgent(i){return STAGE_AGENTS[i]||STAGE_AGENTS[0];}
  window.stageAgent=stageAgent;

  /* Keep all prompts synchronized with their actual workflow stage. */
  const syncedPrompts={
    0:'Review the UKC Pod discussion and connected Teams, Outlook and SharePoint sources, then prepare the campaign context for briefing.',
    1:'Generate the complete campaign brief from the approved commercial objective, UKC Pod discussion and connected sources.',
    2:'Search Adobe Real-Time CDP for the audiences most relevant to the accepted campaign brief and recommend the strongest activatable segments.',
    3:'Prepare the accepted campaign brief and selected audience decisions for human approval in Adobe Workfront.',
    4:'Create the channel production work packages from the approved brief, selected audiences and governance conditions.',
    5:'Search Adobe DAM for assets that match the approved campaign, audiences, formats and channel requirements.',
    6:'Create channel-ready Email and LinkedIn outputs using the accepted brief, selected audiences and approved assets.',
    7:'Prepare the final launch readiness and destination handoff package.'
  };
  Object.keys(syncedPrompts).forEach(k=>{const i=Number(k);if(stages[i])stages[i].prompt=syncedPrompts[i];if(WORKFLOW_CONFIG[i])WORKFLOW_CONFIG[i].prompt=syncedPrompts[i];});
  if(WORKFLOW_CONFIG[0]){WORKFLOW_CONFIG[0].nextPrompt=syncedPrompts[1];WORKFLOW_CONFIG[0].next='Generate campaign brief';}
  if(WORKFLOW_CONFIG[1]){WORKFLOW_CONFIG[1].nextPrompt=syncedPrompts[2];WORKFLOW_CONFIG[1].next='Search Adobe CDP for segments';}
  if(WORKFLOW_CONFIG[2]){WORKFLOW_CONFIG[2].nextPrompt=syncedPrompts[3];WORKFLOW_CONFIG[2].next='Prepare Brief Approval';}
  if(WORKFLOW_CONFIG[3]){WORKFLOW_CONFIG[3].nextPrompt=syncedPrompts[4];WORKFLOW_CONFIG[3].next='Build production plan';}
  if(WORKFLOW_CONFIG[4]){WORKFLOW_CONFIG[4].nextPrompt=syncedPrompts[5];WORKFLOW_CONFIG[4].next='Search Adobe DAM';}
  if(WORKFLOW_CONFIG[5]){WORKFLOW_CONFIG[5].nextPrompt=syncedPrompts[6];WORKFLOW_CONFIG[5].next='Generate channel outputs';}
  if(WORKFLOW_CONFIG[6]){WORKFLOW_CONFIG[6].nextPrompt=syncedPrompts[7];WORKFLOW_CONFIG[6].next='Prepare launch handoff';}

  state.briefEditMode=!!state.briefEditMode;
  state.productionTab=state.productionTab||'Email';
  state.assetTab=Number.isInteger(state.assetTab)?state.assetTab:0;
  state.outputTab=state.outputTab||'email';

  const originalRenderAll=renderAll;
  renderAll=function(options={}){
    originalRenderAll(options);
    const a=stageAgent(state.started?state.focusStage:0);
    const name=document.querySelector('.agent-name'),sub=document.querySelector('.agent-sub');
    if(name)name.textContent=a.name;if(sub)sub.textContent=a.sub;
  };

  stageHeader=function(i,title,desc){
    const step=i===0?'Source grounding':`Stage ${i} of 7`,a=stageAgent(i);
    return `<div class="stage-banner"><div><div class="eyebrow">${step}</div><h2>${esc(title)}</h2>${desc?`<p>${esc(desc)}</p>`:''}<span class="v17-stage-agent">${esc(a.name)}</span></div><span class="status-chip ${state.completed.has(i)?'complete':''}">${state.completed.has(i)?'Completed':'In progress'}</span></div>`;
  };

  renderGeneratingState=function(i,label){
    const def=assetDef(i),a=stageAgent(i),copy=label||state.generationLabel||def.generate;
    let status='Reviewing accepted decisions, source grounding and collaborator input.';
    if(i===2)status=['Reading the accepted brief…','Searching Adobe Real-Time CDP…','Ranking probable segment matches…','Checking activation eligibility and suppressions…','Preparing recommended audiences…'][Math.min(state.stageThinkingStep||0,4)];
    if(i===5)status=['Reading the approved campaign context…','Searching Adobe DAM…','Comparing channel requirements and dimensions…','Checking approval, rights and creative lineage…','Preparing recommended assets…'][Math.min(state.stageThinkingStep||0,4)];
    if(i===6)status=['Packaging accepted campaign context…','Sending approved assets to Adobe GenStudio…','Generating Email execution…','Generating LinkedIn execution…','Applying tracking and accessibility requirements…'][Math.min(state.stageThinkingStep||0,4)];
    return `${stageHeader(i,copy,`${a.name} is preparing the ${def.name.toLowerCase()}.`)}<div class="generation-card"><div class="generation-visual"><div class="generation-doc">${ICON.bot}</div></div><div class="generation-copy"><h3>${esc(copy)} ${teamsTypingDots()}</h3><p>${esc(status)}</p><div class="generation-time">${esc(a.name)} is working</div></div></div>`;
  };

  renderInlineOperation=function(i){
    if(state.generatingStage!==i||state.inlineOperationStage!==i)return '';
    const a=stageAgent(i),label=state.inlineOperationLabel||state.generationLabel||('Updating '+assetDef(i).name);
    return `<div class="inline-operation-state"><div class="inline-operation-avatar">${ICON.bot}</div><div class="inline-operation-copy"><strong>${esc(label)} <span class="inline-operation-dots"><i></i><i></i><i></i></span></strong><span>${esc(a.name)} is applying the requested change while retaining the current version until the update is ready.</span></div></div>`;
  };

  startEmptyState=function(){
    return `<div class="v17-start-card"><div class="v17-start-heading"><div class="start-orb">${ICON.bot}</div><div><h1>Start the iPortal campaign workflow</h1><p>The UKC Pod discussion has established the commercial direction. Review the connected collaboration sources and ask the Campaign Coordinator to ground the campaign before the specialist workflow begins.</p></div></div><div class="v17-commercial-objective"><label>Commercial objective from UKC strategy meeting</label><strong>Deepen client relationships and increase product penetration across priority UKC clients, targeting £7.3m revenue uplift over the next 12 months.</strong></div><div class="v17-source-row"><div class="v17-source-tile"><strong>Teams · UKC Pod</strong><span>Commercial discussion and channel decisions</span></div><div class="v17-source-tile"><strong>Outlook</strong><span>Roadmap, capability and stakeholder context</span></div><div class="v17-source-tile"><strong>SharePoint</strong><span>Campaign evidence, audience and KPI material</span></div></div></div>`;
  };

  openCampaignStudioFromTeams=function(){
    if(!teamsState.summaryReady){toast('Wait for the Marketing Strategy & Campaign Brief Agent to finish preparing the handoff');return;}
    document.getElementById('teamsExperience').style.display='none';
    const app=document.getElementById('appRoot');app.classList.remove('studio-hidden');app.classList.add('not-started');
    state.started=false;state.stage=0;state.focusStage=0;state.sourceSearchComplete=false;state.initialPrompt='';
    state.activities.unshift('UKC Pod commercial discussion handed to Campaign Studio for source grounding');
    originalRenderAll();
    const input=document.getElementById('composerInput');if(input){input.value=syncedPrompts[0];input.placeholder=syncedPrompts[0];}
    requestAnimationFrame(()=>{const a=stageAgent(0),name=document.querySelector('.agent-name'),sub=document.querySelector('.agent-sub');if(name)name.textContent=a.name;if(sub)sub.textContent=a.sub;});
  };

  /* Starting from the restored first screen generates the brief only after the user sends the source-grounding prompt. */
  generateBriefFromSources=function(promptText){
    const connected=Object.values(state.connections).filter(Boolean).length;if(!connected){toast('Select at least one connected source');return;}
    state.initialPrompt=promptText||document.getElementById('composerInput')?.value.trim()||syncedPrompts[0];
    state.campaignName='iPortal Digital Engagement Campaign';state.started=true;state.sourceSearchComplete=true;state.completed.add(0);state.stage=1;state.focusStage=1;state.stagePrompts[1]=syncedPrompts[1];
    addActivity('Connected Teams, Outlook and SharePoint sources grounded against the UKC commercial objective');
    beginStageGeneration(1,'Generating complete campaign brief',syncedPrompts[1]);
  };

  /* Campaign brief: inline editing, rich collaboration and the requested three primary actions. */
  window.toggleBriefInlineEdit=function(){state.briefEditMode=!state.briefEditMode;renderAll();};
  window.cancelBriefInlineEdit=function(){state.briefEditMode=false;renderAll();};
  window.saveBriefInline=function(){
    const fields=[...document.querySelectorAll('[data-brief-edit="1"]')];
    const changes=[];
    fields.forEach(el=>{const si=Number(el.dataset.si),fi=Number(el.dataset.fi),f=briefSections[si]?.fields[fi];if(f&&el.value.trim()&&el.value.trim()!==f[2])changes.push({si,fi,before:f[2],after:el.value.trim(),label:f[1]});});
    if(changes.length){archiveDownstream(1,'Campaign brief edited inline',{label:changes.map(c=>c.label).join(', '),before:'Previous brief field values'});changes.forEach(c=>briefSections[c.si].fields[c.fi][2]=c.after);state.briefVersion+=1;state.lastBriefInstruction=`${changes.length} field${changes.length===1?'':'s'} updated inline.`;addActivity('Campaign brief edited inline');}
    state.briefEditMode=false;renderAll();
  };
  window.generateBriefWithComments=function(){const n=state.comments.filter(c=>c.selected&&!c.incorporated).length;if(!n){openComments();toast('Select collaborator comments to include');return;}regenerateFromComments();};
  window.openBriefFieldEditor=function(si,fi){state.briefEditMode=true;renderAll();requestAnimationFrame(()=>document.querySelector(`[data-brief-edit="1"][data-si="${si}"][data-fi="${fi}"]`)?.focus());};

  renderBrief=function(){
    const tabs=[
      {label:'Business Need',refs:briefSections[0].fields.map((_,fi)=>[0,fi])},
      {label:'Detail & Tactics',keys:['insight','painPoints','qualObjectives','cta','architecture','tactics','budget','timings']},
      {label:'Audience & Channels',keys:['persona','attributes','priorInsights','channels','media','audienceMessaging','assets']},
      {label:'Measurement',keys:['quantObjectives','kpis','measurement','development','integration','reporting']}
    ];
    const refsFor=t=>{const cfg=tabs[t];if(cfg.refs)return cfg.refs;const r=[];briefSections.forEach((s,si)=>s.fields.forEach((f,fi)=>{if(cfg.keys.includes(f[0]))r.push([si,fi]);}));return r;};
    const tab=Math.min(3,Math.max(0,state.briefTab||0)),refs=refsFor(tab),showAll=!!state.briefShowAll[tab],visible=showAll?refs:refs.slice(0,5),selected=state.comments.filter(c=>c.selected&&!c.incorporated).length,busy=state.generatingStage!==null||state.savingStage!==null,editing=!!state.briefEditMode;
    return `${stageHeader(1,'Complete campaign brief','Commercial strategy translated into an editable campaign brief.')}<p class="answer-intro">The brief connects the £7.3m commercial objective to the iPortal audience, channel and measurement strategy.</p><div class="clean-grounding"><strong>Grounded in:</strong> UKC Pod, Teams, Outlook and SharePoint evidence.</div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${ICON.file}${esc(state.campaignName)}</div><div class="clean-brief-meta">${state.briefId?`<span class="brief-id">${esc(state.briefId)}</span>`:''}<span class="clean-badge ${state.briefId?'success':'blue'}">v${state.briefVersion}.0 · ${state.briefId?'Accepted':'Draft'}</span><button class="collaborator-trigger" onclick="openComments()"><span class="avatar-stack"><span>JM</span><span>AR</span><span>PK</span><span>+2</span></span><span class="comment-count">${state.comments.length}</span></button></div></div><div class="artifact-body"><div class="clean-brief-tabs">${tabs.map((t,i)=>`<button class="clean-brief-tab ${i===tab?'active':''}" onclick="setBriefTab(${i})">${i+1}. ${esc(t.label)}</button>`).join('')}</div><div class="clean-brief-head"><h4>${esc(tabs[tab].label)}</h4><div class="v17-collab-preview"><span class="v17-collab-preview-label">${state.comments.length} collaborator comments</span></div></div><div class="clean-field-grid">${visible.map(([si,fi],idx)=>{const f=briefSections[si].fields[fi],wide=idx===2||f[2].length>170;return `<div class="clean-field-card ${wide?'wide':''} ${editing?'editing':''}"><label>${esc(f[1])}</label>${editing?`<textarea data-brief-edit="1" data-si="${si}" data-fi="${fi}" rows="${Math.min(6,Math.max(3,Math.ceil(f[2].length/100)))}">${esc(f[2])}</textarea>`:`<p>${esc(f[2])}</p><button class="clean-edit-icon" onclick="openBriefFieldEditor(${si},${fi})" title="Edit inline">✎</button>`}</div>`;}).join('')}</div>${refs.length>5?`<div class="clean-view-more"><button class="btn" onclick="toggleBriefShowAll(${tab})">${showAll?'Show key fields':'View all '+refs.length+' fields'}</button></div>`:''}${editing?`<div class="v17-inline-edit-actions"><button class="btn" onclick="cancelBriefInlineEdit()">Cancel</button><button class="btn primary" onclick="saveBriefInline()">Save changes</button></div>`:''}${state.lastBriefInstruction?`<div class="clean-compact-callout">Latest update: ${esc(state.lastBriefInstruction)}</div>`:''}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" ${busy?'disabled':''} onclick="toggleBriefInlineEdit()">${editing?'Editing brief':'Edit brief'}</button><button class="btn" ${busy?'disabled':''} onclick="generateBriefWithComments()">Generate with collaborator comments${selected?' ('+selected+')':''}</button><button class="btn primary" ${state.acceptedAssets[1]||busy?'disabled':''} onclick="acceptBrief()">${state.acceptedAssets[1]?'Accepted':'Accept brief'}</button></div>${renderInlineOperation(1)}</div></div>`;
  };

  /* Segmentation: explicit Adobe CDP discovery, richer cards, clone and per-card suppressions. */
  renderSegments=function(){
    const selected=state.segments.filter(x=>x.selected),total=state.segments.reduce((a,b)=>a+b.count,0),stageSelected=selectedCommentsForStage(2),busy=state.generatingStage!==null||state.savingStage!==null;
    return `${stageHeader(2,'Audience segmentation','Adobe Real-Time CDP audience discovery and activation fit.')}<div class="v17-cdp-note"><div class="v17-cdp-icon">CDP</div><div><strong>Probable applicable audiences found in Adobe Real-Time CDP</strong><span>These are the strongest matches based on the accepted campaign brief, client behaviour, iPortal adoption signals, eligibility and channel readiness.</span></div></div><div class="clean-summary-row"><div class="clean-summary-stat"><strong>${state.segments.length}</strong><span>Probable matches</span></div><div class="clean-summary-stat"><strong>${total.toLocaleString('en-GB')}</strong><span>Matched CSIDs</span></div><div class="clean-summary-stat"><strong>${selected.reduce((a,b)=>a+b.count,0).toLocaleString('en-GB')}</strong><span>Selected audience</span></div></div><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(2)}Adobe CDP segment recommendations</div>${renderAssetHeaderRight(2,selected.length+' selected')}</div><div class="artifact-body"><div class="v17-segment-list">${state.segments.map((s,i)=>`<div class="v17-segment-card ${s.selected?'selected':''}"><div class="v17-segment-head"><input class="clean-check" type="checkbox" ${s.selected?'checked':''} onchange="toggleSegment(${i})"><div class="v17-segment-title"><h4>${esc(s.name)}</h4><p>${s.count.toLocaleString('en-GB')} CSIDs · ${esc(s.channel)} · ${s.active==='Yes'?'Strong match · Activatable':'Relevant match · Review activation'}</p></div><div class="v17-segment-tools"><button class="clone-btn" onclick="cloneSegment(${i})">Clone</button><button class="collaborator-trigger" onclick="openSegmentComments(${i})"><span class="comment-count">${(s.comments||[]).length}</span> Comments</button></div></div><div class="v17-segment-body"><div class="v17-segment-rule">${esc(s.rule)}</div><div class="v17-segment-grid"><div class="v17-segment-info"><label>Why it fits</label><span>${esc(s.why)}</span></div><div class="v17-segment-info"><label>Client need</label><span>${esc(s.needs)}</span></div></div><details class="v17-suppressions"><summary>View suppressions (${(s.suppressions||[]).length})</summary><ul>${(s.suppressions||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details></div></div>`).join('')}</div>${state.addSegmentOpen?renderAddSegmentForm():''}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="addSegment()">Add segment</button><button class="btn" ${busy?'disabled':''} onclick="${stageSelected?`applyStageComments(2)`:`openAssetComments(2)`}">Generate with collaborator comments${stageSelected?' ('+stageSelected+')':''}</button><button class="btn primary" ${selected.length&&!busy?'':'disabled'} onclick="acceptStageAsset(2,'Audience segment set')">Accept segments</button></div>${renderInlineOperation(2)}</div></div>`;
  };

  /* Brief Approval: exact requested action set, retaining the existing Workfront modal. */
  renderApproval=function(){
    const segs=state.segments.filter(s=>s.selected).map(s=>s.name).join(', '),rec=state.acceptedAssets[3],processing=state.approvalSubmitting||state.savingStage===3,selected=selectedCommentsForStage(3),busy=processing||state.generatingStage!==null;
    return `${stageHeader(3,'Brief approval','Human governance and Adobe Workfront routing.')}<div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(3)}Approval package</div>${renderAssetHeaderRight(3,rec?(rec.decision||'Approved'):'Awaiting approval')}</div><div class="artifact-body"><div class="approval-summary-grid"><div class="approval-summary-item"><label>Commercial objective</label><span>Deepen UKC relationships · £7.3m revenue uplift target</span></div><div class="approval-summary-item"><label>Selected audiences</label><span>${esc(segs)}</span></div><div class="approval-summary-item"><label>Channels</label><span>Email · LinkedIn</span></div><div class="approval-summary-item"><label>Budget / timing</label><span>£310,102 · September launch</span></div></div><div class="clean-compact-callout"><strong>Approval conditions:</strong> ${esc(state.approvalConditions)}</div><div class="clean-list"><div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>James Okonkwo — Head of GTB</strong><span>Strategy, scope and investment</span></div><span class="clean-badge ${rec?'success':'warning'}">${rec?'Approved':'Pending'}</span></div></div><div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>Helen Marsh — Brand Lead</strong><span>Claims, evidence gaps and mandatory constraints</span></div><span class="clean-badge ${rec?'success':'warning'}">${rec?'Approved with conditions':'Pending'}</span></div></div></div>${rec?`<details class="clean-expand"><summary>View Workfront approval record</summary><div class="clean-expand-body"><p><strong>Approval ID:</strong> ${esc(rec.id)}</p><p><strong>Workfront:</strong> ${esc(rec.workfrontReference||state.workfrontReference||'Recorded')}</p><p><strong>Approved by:</strong> ${esc(rec.approvedBy||'James Okonkwo and Helen Marsh')}</p><p><strong>Decision:</strong> ${esc(rec.decision||'Approved')}</p></div></details>`:''}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" ${busy?'disabled':''} onclick="openAssetEditModal(3)">Edit</button><button class="btn" ${busy?'disabled':''} onclick="${selected?`applyStageComments(3)`:`openAssetComments(3)`}">Generate with collaborator comments${selected?' ('+selected+')':''}</button><button class="btn primary" ${processing||rec?'disabled':''} onclick="openBriefApprovalModal()">${rec?'Approved':'Route in Workfront'}</button></div>${processing?`<div class="approval-processing-state"><div class="approval-processing-spinner"></div><div class="approval-processing-copy"><strong>${esc(state.savingLabel||'Routing approval…')}</strong><span>Creating tasks, recording approver decisions and registering the governance record.</span></div></div>`:''}${renderInlineOperation(3)}</div></div>`;
  };

  /* Production Plan: channel tabs with full work-package detail and required actions. */
  window.setProductionTab=function(channel){state.productionTab=channel;renderAll();};
  renderProduction=function(){
    const channels=[...new Set(state.production.map(p=>p.channel))],activeChannel=channels.includes(state.productionTab)?state.productionTab:channels[0],items=state.production.filter(p=>p.channel===activeChannel),active=state.production.filter(p=>!p.removed),selected=selectedCommentsForStage(4),busy=state.generatingStage!==null||state.savingStage!==null;
    return `${stageHeader(4,'Production plan','Channel-specific work packages ready for execution.')}<p class="answer-intro">Review the work packages by channel, then create Workfront tasks or accept the production plan.</p><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(4)}Channel work packages</div>${renderAssetHeaderRight(4,active.length+' active')}</div><div class="artifact-body"><div class="v17-tabs">${channels.map(c=>`<button class="v17-tab ${c===activeChannel?'active':''}" onclick="setProductionTab('${esc(c)}')">${esc(c)}</button>`).join('')}</div>${items.map((p,i)=>{const realIndex=state.production.indexOf(p);return `<div class="v17-package" style="${p.removed?'opacity:.5':''}"><div class="v17-package-head"><div><h4>${esc(p.asset)}</h4><p>${esc(p.audience)} · ${esc(p.owner)} · ${esc(p.timing)}</p></div><span class="clean-badge ${p.removed?'warning':'blue'}">${p.removed?'Excluded':'Ready'}</span></div><div class="v17-package-grid"><div class="v17-kv"><label>Requirement</label><span>${esc(p.message)}</span></div><div class="v17-kv"><label>Format</label><span>${esc(p.format)}</span></div><div class="v17-kv"><label>Owner</label><span>${esc(p.owner)}</span></div><div class="v17-kv"><label>Timing</label><span>${esc(p.timing)}</span></div></div><div class="clean-inline-actions"><button class="btn" onclick="openSubAssetComments(4,'production-${p.id}','${esc((p.channel+' · '+p.asset).replace(/'/g,"\\'"))}')">Comments (${(state.subAssetComments['production-'+p.id]||[]).length})</button><button class="btn danger" onclick="toggleProduction(${realIndex})">${p.removed?'Restore':'Remove'}</button></div></div>`;}).join('')}</div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="toast('Workfront work packages created')">Create Workfront tasks</button><button class="btn" ${busy?'disabled':''} onclick="openAssetEditModal(4)">Edit</button><button class="btn" ${busy?'disabled':''} onclick="${selected?`applyStageComments(4)`:`openAssetComments(4)`}">Generate with collaborator comments${selected?' ('+selected+')':''}</button><button class="btn primary" ${busy?'disabled':''} onclick="acceptStageAsset(4,'Production plan')">Accept production plan</button></div>${renderInlineOperation(4)}</div></div>`;
  };

  /* Asset Library: one recommended-asset tab at a time, external agency review retained here. */
  window.setAssetTab=function(i){state.assetTab=i;renderAll();};
  renderAssets=function(){
    const selected=state.assets.filter(a=>a.included),tab=Math.min(state.assets.length-1,Math.max(0,state.assetTab||0)),a=state.assets[tab],reusable=state.assets.filter(x=>x.matchStatus==='Reusable').length,adapt=state.assets.filter(x=>x.matchStatus==='Adaptation recommended').length,gaps=state.assets.filter(x=>x.matchStatus.includes('No suitable')).length,stageSelected=selectedCommentsForStage(5),busy=state.generatingStage!==null||state.savingStage!==null;
    const created=a.generated||a.adapted;
    return `${stageHeader(5,'Search Asset Library','Adobe DAM matching, GenStudio adaptation and external creative review.')}<div class="clean-summary-row"><div class="clean-summary-stat"><strong>46</strong><span>DAM assets reviewed</span></div><div class="clean-summary-stat"><strong>${reusable}</strong><span>Reuse</span></div><div class="clean-summary-stat"><strong>${adapt}</strong><span>Adapt</span></div><div class="clean-summary-stat"><strong>${gaps}</strong><span>Create</span></div></div>${renderDamCriteria()}<div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(5)}Recommended assets</div>${renderAssetHeaderRight(5,selected.length+' selected')}</div><div class="artifact-body"><div class="v17-tabs">${state.assets.map((x,i)=>`<button class="v17-tab ${i===tab?'active':''}" onclick="setAssetTab(${i})">${esc(x.channel)} · ${esc(x.requirement.replace(/^LinkedIn sponsored content — /i,'').replace(/^Email — /i,''))}</button>`).join('')}</div><div class="v17-asset-layout"><div class="v17-asset-preview">${damPreview(a)}</div><div class="v17-asset-main"><h3>${esc(a.requirement)}</h3><div class="v17-asset-meta">${esc(a.sourceType==='Requirement'?'Adobe DAM search':a.sourceType)} · ${esc(a.format)} · ${esc(a.dimensions)}</div><div class="tag-row"><span class="clean-badge ${a.matchStatus==='Reusable'?'success':'warning'}">${esc(a.matchStatus)}</span><span class="clean-badge blue">${esc(a.confidence)}</span></div><div class="v17-recommendation"><strong>Recommendation:</strong> ${esc(a.matchReason)}</div>${state.damGeneratingId===a.id?`<div class="genstudio-inline"><div class="genstudio-mark">Gs</div><div><strong>${a.found?'Adapting in Adobe GenStudio':'Creating in Adobe GenStudio'} ${teamsTypingDots()}</strong><span>Using the approved campaign context and supplied iPortal creative.</span></div></div>`:''}<div class="v17-agency-strip">${externalStatusMarkup(a)}</div><label class="asset-choice"><input type="checkbox" ${a.included?'checked':''} onchange="toggleAsset(${tab})"> Select for campaign</label><div class="v17-asset-controls">${a.found&&!a.generated?`<button class="btn" onclick="previewDamAsset(${tab})">Preview</button><button class="btn" onclick="openGenStudioRequest(${tab},'modify')">Modify in GenStudio</button>`:`<button class="btn" onclick="openGenStudioRequest(${tab},'create')">${created?'Request another version':'Create in GenStudio'}</button>`}${created?`<button class="btn" onclick="openExternalApprovalRequest('asset','${tab}')">Send for agency approval</button>`:''}<button class="btn" onclick="openSubAssetComments(5,'${esc(a.commentsKey)}','${esc(a.requirement.replace(/'/g,"\\'"))}')">Threaded comments (${(state.subAssetComments[a.commentsKey]||[]).length})</button></div><details class="v17-asset-details"><summary>View approval, rights and lineage</summary><div class="clean-expand-body"><p><strong>Approval:</strong> ${esc(a.approval)}</p><p><strong>Rights / expiry:</strong> ${esc(a.rights)} · ${esc(a.expiry)}</p><p><strong>Lineage:</strong> ${a.adapted?`Adobe DAM ${esc(a.sourceAssetId||a.id)} → Adobe GenStudio ${esc(a.jobId)}`:a.generated?`Adobe GenStudio · ${esc(a.jobId)}`:a.found?`Adobe DAM · ${esc(a.id)}`:'Campaign requirement · no DAM match'}</p></div></details></div></div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="toggleDamCriteria()">${state.damCriteriaOpen?'Hide':'View'} search evidence</button><button class="btn" ${busy?'disabled':''} onclick="${stageSelected?`applyStageComments(5)`:`openAssetComments(5)`}">Generate with collaborator comments${stageSelected?' ('+stageSelected+')':''}</button><button class="btn primary" ${selected.length&&!busy?'':'disabled'} onclick="acceptStageAsset(5,'Asset-selection package')">Accept selected assets</button></div>${renderInlineOperation(5)}</div></div>`;
  };

  /* Channel outputs: no external-agency review here; one package per tab with realistic preview. */
  window.setOutputTab=function(key){state.outputTab=key;renderAll();};
  window.generateOutputFromComments=function(key){const o=state.outputs[key];state.subAssetMeta[o.commentsKey]={stage:6,title:o.label,locations:['Overall output','Headline and body copy','CTA','Channel execution']};state.commentAsset={type:'subasset',key:o.commentsKey,stage:6};const n=(state.subAssetComments[o.commentsKey]||[]).filter(c=>c.selected&&!c.incorporated).length;if(!n){openSubAssetComments(6,o.commentsKey,o.label);toast('Select collaborator comments to include');return;}applySubAssetComments();};
  renderOutputPreview=function(o){
    const creative=window.IPORTAL_CREATIVE||'';
    if(o.channel==='Email')return `<div class="v17-output-shell"><div class="v17-email-preview"><div class="v17-email-top"><strong>Subject:</strong> ${esc(o.headline)} &nbsp; · &nbsp; <strong>Preheader:</strong> Practical ways to do more digitally with iPortal</div><div class="v17-email-brand"><strong>Barclays Corporate</strong><span class="clean-badge blue">iPortal</span></div><div class="v17-email-creative" style="background-image:url('${creative}')"></div><div class="v17-email-copy"><h3>${esc(o.headline)}</h3><p>${esc(o.body)}</p><button class="v17-real-cta">${esc(o.cta)}</button></div><div class="v17-email-footer">Barclays Corporate · This campaign uses approved iPortal capability language and campaign tracking. Preferences and regulatory information would appear here in production.</div></div></div>`;
    return `<div class="v17-output-shell"><div class="v17-linkedin-preview"><div class="v17-li-head"><div class="v17-li-avatar">B</div><div><strong>Barclays Corporate Banking</strong><span>Sponsored · Promoted to priority UKC roles</span></div></div><div class="v17-li-copy">${esc(o.body)}</div><div class="v17-li-creative" style="background-image:url('${creative}')"></div><div class="v17-li-card"><div><strong>${esc(o.headline)}</strong><span>barclayscorporate.com · iPortal</span></div><button class="btn">${esc(o.cta)}</button></div><div class="v17-li-actions"><span>Like</span><span>Comment</span><span>Share</span><span>Send</span></div></div></div>`;
  };
  previewOutput=function(key){const o=state.outputs[key];document.getElementById('modalRoot').innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal wide"><h2>${esc(o.label)} preview</h2><p>${esc(o.channel)} · ${esc(o.format)} · v${o.version}.0</p>${renderOutputPreview(o)}<div class="modal-actions"><button class="btn primary" onclick="closeModal()">Close preview</button></div></div></div>`;};
  renderOutputs=function(){
    const keys=Object.keys(state.outputs),key=keys.includes(state.outputTab)?state.outputTab:keys[0],o=state.outputs[key],approved=Object.values(state.outputs).filter(x=>x.approved&&!x.excluded).length,busy=state.outputGeneratingKey===key||state.outputSavingKey===key||state.generatingStage!==null||state.savingStage!==null;
    const comments=(state.subAssetComments[o.commentsKey]||[]),selected=comments.filter(c=>c.selected&&!c.incorporated).length;
    return `${stageHeader(6,'Create channel outputs','Adobe GenStudio channel packages ready for review and acceptance.')}<p class="answer-intro">Each package retains the approved iPortal creative and adapts the execution for the selected audience and channel.</p><div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(6)}Channel output package</div>${renderAssetHeaderRight(6,approved+' accepted')}</div><div class="artifact-body"><div class="v17-tabs">${keys.map(k=>`<button class="v17-tab ${k===key?'active':''}" onclick="setOutputTab('${k}')">${esc(state.outputs[k].channel)}</button>`).join('')}</div><div class="v17-package"><div class="v17-package-head"><div><h4>${esc(o.label)}</h4><p>Adobe GenStudio · ${esc(o.jobId)} · v${o.version}.0 · ${esc(o.audience)}</p></div><span class="clean-badge ${o.approved?'success':'blue'}">${o.approved?'Accepted':'Draft'}</span></div><div style="margin-top:10px">${renderOutputPreview(o)}</div>${state.outputGeneratingKey===key?`<div class="genstudio-inline"><div class="genstudio-mark">Gs</div><div><strong>Channel Content Agent is preparing the updated output ${teamsTypingDots()}</strong><span>The current output remains visible during generation.</span></div></div>`:''}<details class="v17-output-details"><summary>View format, tracking, accessibility and source details</summary><div class="v17-package-grid"><div class="v17-kv"><label>Format</label><span>${esc(o.format)} · ${esc(o.dimensions)}</span></div><div class="v17-kv"><label>Source asset</label><span>${esc(o.sourceAssetIds.join(', '))}</span></div><div class="v17-kv"><label>Tracking</label><span>${esc(o.tracking)}</span></div><div class="v17-kv"><label>Accessibility</label><span>${esc(o.accessibility)}</span></div></div></details><div class="v17-output-actions"><button class="btn" ${busy?'disabled':''} onclick="openOutputEdit('${key}')">Edit</button><button class="btn" ${busy?'disabled':''} onclick="generateOutputFromComments('${key}')">Generate with collaborator comments${selected?' ('+selected+')':''}</button><button class="btn" onclick="previewOutput('${key}')">Preview</button><button class="btn primary" ${busy||o.approved?'disabled':''} onclick="acceptOutput('${key}')">${o.approved?'Accepted':'Accept output'}</button></div></div></div><div class="artifact-actions"><div class="clean-primary-actions"><button class="btn" onclick="openOutputPackageTechnicalDetails()">Package details</button><button class="btn primary" ${approved&&!state.acceptedAssets[6]?'':'disabled'} onclick="acceptStageAsset(6,'Channel output package')">Accept output package</button></div>${renderInlineOperation(6)}</div></div>`;
  };

  /* Launch readiness no longer treats output-stage agency review as a dependency; agency review belongs to Asset Library. */
  renderLaunch=function(){
    const approved=Object.entries(state.outputs).filter(([,v])=>v.approved),assetAgency=state.assets.filter(a=>a.included&&(a.generated||a.adapted)).map(a=>({name:a.requirement,status:a.externalApprovalStatus||'Not requested',version:a.version||1})),waiting=assetAgency.filter(r=>/Awaiting|Preparing|Reapproval/.test(r.status)).length;
    const readiness=[['Audience lists','Ready'],['Brief approval',state.acceptedAssets[3]?'Ready':'Needs attention'],['Asset agency review',waiting?'Needs attention':'Ready'],['Channel outputs',approved.length?'Ready':'Needs attention'],['Tracking','Ready']];
    return `${stageHeader(7,'Launch handoff','Confirm campaign readiness and destination handoff.')}<div class="artifact"><div class="artifact-head"><div class="artifact-title">${assetIconForStage(7)}Launch readiness</div>${renderAssetHeaderRight(7,state.published?'Published':waiting?'Needs attention':'Ready')}</div><div class="artifact-body"><div class="clean-list">${readiness.map(([n,s])=>`<div class="clean-row"><div class="clean-row-main"><div class="clean-row-copy"><strong>${esc(n)}</strong></div><span class="clean-badge ${s==='Ready'?'success':'warning'}">${esc(s)}</span></div></div>`).join('')}</div><details class="clean-expand"><summary>View Asset Library agency approvals</summary><div class="clean-expand-body">${assetAgency.map(r=>`<p><strong>${esc(r.name)}</strong> · v${r.version}.0 · ${esc(r.status)}</p>`).join('')||'<p>No external agency review required.</p>'}</div></details><div class="answer-section"><h3>Destinations</h3>${approved.map(([key,v])=>`<div class="destination"><div><strong>${esc(v.label)}</strong><div class="field-hint">${key==='email'?'CRM / ESP':'LinkedIn Campaign Manager'}</div></div><span class="row-status pass">${state.published?'✓ Published':'Queued'}</span></div>`).join('')}<div class="destination"><div><strong>GA4 / campaign dashboard</strong><div class="field-hint">Tracking and measurement handoff</div></div><span class="row-status pass">${state.published?'✓ Configured':'Queued'}</span></div></div></div><div class="artifact-actions"><div class="clean-primary-actions">${state.published?`<button class="btn" onclick="exportState()">Export</button>`:`<button class="btn" onclick="holdLaunch()">Hold</button><button class="btn" onclick="publishCampaign(true)">Approve with conditions</button><button class="btn primary" onclick="publishCampaign(false)">Confirm publish</button>`}</div>${renderInlineOperation(7)}</div></div>`;
  };

  /* Make the next-stage CTA from accepted assets explicitly say Generate channel outputs. */
  const oldPrepareNext=prepareNextStagePrompt;
  prepareNextStagePrompt=function(i){oldPrepareNext(i);if(i===5){const input=document.getElementById('composerInput');if(input){input.value=syncedPrompts[6];input.placeholder=syncedPrompts[6];}toast('Generate channel outputs prompt is ready.');}};

  /* Keep the initial Input/Source Grounding stage visible in the workflow navigation. */
  renderNav=function(){
    const titles=document.querySelectorAll('.left .rail-title');if(titles[0])titles[0].textContent='Campaign planning';if(titles[1])titles[1].textContent='Production';
    const make=indexes=>indexes.map(i=>{const st=stages[i];return `<div class="stage ${i===state.focusStage?'active':''} ${state.completed.has(i)?'complete':''}" onclick="goStage(${i})"><div class="stage-dot">${state.completed.has(i)?'✓':i+1}</div><div class="stage-copy"><div class="stage-name">${esc(st.name.replace(/^\d+\. /,''))}</div></div></div>`;}).join('');
    document.getElementById('briefStages').innerHTML=make([0,1,2,3]);document.getElementById('productionStages').innerHTML=make([4,5,6,7]);
  };
  stageHeader=function(i,title,desc){const a=stageAgent(i);return `<div class="stage-banner"><div><div class="eyebrow">Stage ${i+1} of ${stages.length}</div><h2>${esc(title)}</h2>${desc?`<p>${esc(desc)}</p>`:''}<span class="v17-stage-agent">${esc(a.name)}</span></div><span class="status-chip ${state.completed.has(i)?'complete':''}">${state.completed.has(i)?'Completed':'In progress'}</span></div>`;};

  function stageAssistantMessage(i,content){const a=stageAgent(i);return `<div class="message assistant"><div class="avatar">${ICON.bot}</div><div class="bubble"><div class="assistant-label">${esc(a.name)}</div>${content}</div></div>`;}
  assistantMessage=function(content){return stageAssistantMessage(state.focusStage??state.stage,content);};
  renderConversation=function(){
    let html='';
    for(let i=0;i<=state.stage;i++){
      const st=stages[i];let content='';
      if(i===0){content=userMessage(state.initialPrompt||syncedPrompts[0])+stageAssistantMessage(0,renderInput());}
      else if(state.generatingStage===i&&state.inlineOperationStage!==i){content=(i>1?userMessage(state.stagePrompts[i]||st.prompt):'')+stageAssistantMessage(i,renderGeneratingState(i));}
      else if(i===1){content=stageAssistantMessage(1,renderBrief()+renderAcceptedAsset(i));}
      else if(i===2&&!state.segmentGenerated){content=userMessage(state.stagePrompts[i]||st.prompt)+stageAssistantMessage(2,renderGeneratingState(i));}
      else{content=userMessage(state.stagePrompts[i]||st.prompt)+stageAssistantMessage(i,renderStage(i)+renderAcceptedAsset(i));}
      content+=(state.customMessages[st.id]||[]).join('');
      html+=`<section class="conversation-stage" id="conversation-stage-${i}"><div class="stage-anchor-label">${esc(st.name)}</div>${content}</section>`;
    }
    return html;
  };

  renderAcceptedAsset=function(i){
    const rec=state.acceptedAssets[i];if(!rec)return renderSavingState(i);const def=assetDef(i),next=def.nextStageIndex;
    const nextButton=next!==null&&state.stage<=i?(i===5?`<button class="btn primary" onclick="prepareNextStagePrompt(5)">Generate channel outputs</button>`:`<button class="btn primary" onclick="prepareNextStagePrompt(${i})">Next: ${esc(def.nextStageLabel)}</button>`):'';
    return `<div class="clean-accepted"><div><strong>${esc(def.name)} accepted</strong><span> · ${esc(rec.id)}</span></div><div style="display:flex;align-items:center;gap:7px"><span class="asset-id-pill">${esc(rec.id)}</span>${nextButton}</div></div>`;
  };

  /* Refresh current visible experience. */
  if(document.getElementById('appRoot')&&!document.getElementById('appRoot').classList.contains('studio-hidden'))renderAll();else renderTeams();
})();
