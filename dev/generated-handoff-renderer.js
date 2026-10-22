(async function validateGeneratedHandoff() {
  "use strict";
  const api = window.desktopAPI, fixture = await api.getDevHandoffFixture("state");
  if (!fixture) return;
  const persistence = window.ViralCoreProjectPersistence, controller = window.ViralCoreGeneratedMedia;
  const report = { ok: false, checks: {}, restarted: fixture.restarted };
  const check = (name, value) => { report.checks[name] = !!value; if (!value) throw Error(name); };
  const badge = document.createElement("div");
  badge.id = "dev-generated-handoff";
  badge.setAttribute("role", "status");
  Object.assign(badge.style, { position: "fixed", insetInlineEnd: "18px", bottom: "18px", zIndex: "9999",
    padding: "12px", background: "#172033", color: "#fff", border: "1px solid #7ee7d1", maxWidth: "420px", fontSize: "13px" });
  const copy = window.I18N.messages[state.locale || "vi"].devHandoff;
  badge.textContent = copy.running;
  document.body.append(badge);
  // Bounded readiness observation, never timer-derived completion.
  const wait = async fn => {
    const until = Date.now() + 15000;
    while (!fn()) { if (Date.now() > until) throw Error("DEV preview timeout"); await new Promise(resolve => setTimeout(resolve, 40)); }
  };
  const registry = () => JSON.parse(localStorage.getItem(persistence.registryKey));
  const verifyCounts = snapshot => {
    check("oneAsset", snapshot.media.assets.length === 1);
    check("oneSource", snapshot.workflow.jobs.filter(j => j.generationJobId === report.jobId).length === 1);
    check("oneReference", snapshot.workflow.generationOutputs.length === 1 && !!snapshot.workflow.generationOutputs[0].assetId);
    check("generatedOrigin", snapshot.media.assets[0].origin === "generated");
    check("canonicalAssetId", snapshot.media.assets[0].id === "generation:" + report.jobId);
    check("sourceIdentity", snapshot.source.path === snapshot.media.assets[0].localPath &&
      snapshot.workflow.jobs[0].id === "generation-source:" + report.jobId);
    check("sceneAssociation", snapshot.workflow.jobs[0].sceneId === report.sceneId && snapshot.scenePlan.selectedSceneId === report.sceneId);
  };
  try {
    // The normal bootstrap owns its initial Home route. Do not race that route
    // or snapshot a video while the first-paint guard still hides the page.
    await wait(() => ["ready", "recovered"].includes(document.documentElement.dataset.coreFirstPaint));
    let project;
    if (!fixture.identity) {
      check("freshRegistry", persistence.listProjects().length === 0);
      project = await persistence.createProject({ kind: "ai", projectName: copy.projectA });
      check("freshAI", project.projectKind === "ai" && project.source === null && project.media.assets.length === 0);
      check("oneScene", project.scenePlan.scenes.length === 1 && !!project.scenePlan.selectedSceneId);
      const job = await api.getDevHandoffFixture("enroll", { projectId: project.projectId, sceneId: project.scenePlan.selectedSceneId });
      Object.assign(report, { jobId: job.id, projectId: job.projectId, sceneId: job.sceneId });
      await controller.track(job); // Enrollment through real persistence/controller.
      check("notCompletedCannotAttach", controller.status(job.id) === "pending" && persistence.snapshot().media.assets.length === 0);
      const b = await persistence.createProject({ kind: "ai", projectName: copy.projectB });
      report.projectB = b.projectId;
      const before = localStorage.getItem(persistence.registryKey);
      if (fixture.mode === "persistence-failure") window.__devHandoffFailRegistry = true;
      try {
        await api.getDevHandoffFixture("complete");
        await controller.observe(job.id);
        if (!["completed", "manual-recovery"].includes(fixture.mode)) {
          check("noPartialPublication", JSON.stringify(registry().projects.find(p => p.projectId === job.projectId)) ===
            JSON.stringify(JSON.parse(before).projects.find(p => p.projectId === job.projectId)));
          check("noFalseAttached", controller.status(job.id) !== "attached");
          check("truthfulAttachmentState", controller.status(job.id) === (fixture.mode === "noncompleted" ? "pending" : "error"));
          const persisted = await api.getGenerationJob(job.id);
          check("generationUnchanged", persisted.ok && persisted.value.status === (fixture.mode === "noncompleted" ? "queued" : "completed"));
          if (["tampered", "legacy"].includes(fixture.mode)) {
            const output = await api.getGenerationOutput(job.id);
            check("outputRejected", fixture.mode === "tampered" ? !output.ok : output.ok && output.value.verified === false);
          }
          report.ok = true;
          badge.textContent = copy.negativePassed;
          await api.getDevHandoffFixture("report", report);
          return;
        }
      } finally { window.__devHandoffFailRegistry = false; }
      check("activeBUnchanged", persistence.activeProjectId() === b.projectId);
      check("projectBUntouched", persistence.snapshot().source === null && persistence.snapshot().media.assets.length === 0);
      project = registry().projects.find(p => p.projectId === job.projectId);
      verifyCounts(project);
      persistence.openProject(job.projectId);
    } else {
      Object.assign(report, fixture.identity);
      check("restartActiveProject", persistence.activeProjectId() === report.projectId);
      check("restartBothProjects", persistence.listProjects().length === 2);
      project = persistence.snapshot();
      verifyCounts(project);
    }
    const output = await api.getGenerationOutput(report.jobId);
    check("realVerifiedOutput", output.ok && output.value.verified === true);
    const meta = await api.probeVideo(output.value.path);
    check("realProbe", meta.duration > 0 && meta.width === 160 && meta.height === 90);
    report.output = { fileName: output.value.fileName, metadata: meta };
    const unique = () => {
      const snapshot = persistence.snapshot();
      return snapshot.media.assets.length === 1 && snapshot.workflow.jobs.length === 1 && snapshot.workflow.generationOutputs.length === 1;
    };
    await api.getDevHandoffFixture("duplicates");
    await new Promise(resolve => setTimeout(resolve, 0));
    check("duplicateEventsIdempotent", unique());
    await Promise.all([controller.observe(report.jobId), controller.observe(report.jobId)]);
    check("repeatedObserveIdempotent", unique());
    render(); render();
    check("rerenderIdempotent", unique());
    window.dispatchEvent(new Event("focus"));
    await new Promise(resolve => setTimeout(resolve, 0));
    check("focusIdempotent", unique());
    verifyCounts(persistence.snapshot());
    // Private Beta enters the same Studio contextually from the active Project.
    // The global legacy Studio navigation is deliberately hidden in that shell.
    if (document.documentElement.dataset.privateBeta === "true") {
      state.page = "ai-create"; render();
    }
    const studio = document.querySelector('[data-page="ai-video"]') || document.querySelector('[data-ai-route="ai-video"]');
    check("ordinaryStudioNavigation", !!studio);
    studio.click();
    await wait(() => {
      const node = document.querySelector("#page video.preview-video");
      if (!node || node.readyState < 2) return false;
      const bounds = node.getBoundingClientRect(), css = getComputedStyle(node);
      report.previewLayout = { width: bounds.width, height: bounds.height, display: css.display,
        visibility: css.visibility, opacity: css.opacity, firstPaint: document.documentElement.dataset.coreFirstPaint, ancestors: [] };
      let parent = node.parentElement;
      for (let i = 0; parent && i < 4; i++, parent = parent.parentElement) {
        const box = parent.getBoundingClientRect();
        report.previewLayout.ancestors.push({ className: parent.className, width: box.width, height: box.height,
          display: getComputedStyle(parent).display, visibility: getComputedStyle(parent).visibility });
      }
      return bounds.width > 0 && bounds.height > 0 && css.display !== "none" && css.visibility !== "hidden" && Number(css.opacity) > 0;
    });
    const video = document.querySelector("#page video.preview-video");
    check("nativeVideoDecoded", video.readyState >= 2 && !video.error && video.videoWidth === 160 && video.videoHeight === 90 && video.duration > 0);
    const rect = video.getBoundingClientRect(), style = getComputedStyle(video);
    check("studioPreviewVisible", rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0);
    check("normalStudioSource", state.page === "ai-video" && latestSourceJob().generationJobId === report.jobId && !!latestSourceJob().previewUrl);
    verifyCounts(persistence.snapshot());
    check("durableFlush", !!persistence.flush("dev-handoff-checkpoint"));
    report.ok = true;
    badge.textContent = copy.passed;
  } catch (error) {
    report.error = String(error.message || error).slice(0, 180);
    badge.textContent = copy.failed + " " + report.error;
  }
  await api.getDevHandoffFixture("report", report);
})();
