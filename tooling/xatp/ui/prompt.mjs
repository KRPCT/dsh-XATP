/** Keep an unsaved prompt edit pinned to its starting revision, including across read conflicts. */
export function promptEditor({ el, button }, t, api, afterSave) {
  const drafts = new Map();
  let activeEditor;

  return function renderPrompt(container, record, latest) {
    activeEditor = undefined;
    if (record.kind !== 'prompt' || typeof api.editPrompt !== 'function') return;
    const key = JSON.stringify([record.id, record.version]);
    const area = el('section', 'x-prompt-editor');
    container.append(area);

    activeEditor = { key, area, draw };
    function draw() {
      area.replaceChildren();
      const draft = drafts.get(key);
      if (!draft) {
        if (latest.version !== record.version) return;
        area.append(button(t('editPrompt'), () => {
          drafts.set(key, { text: record.data.text || '', creativeRationale: record.data.creativeRationale || '' });
          draw();
          area.querySelector('textarea').focus();
        }));
        return;
      }
      const form = el('form', 'x-prompt-form');
      const inputs = {};
      const submit = el('button', 'x-btn x-primary', t(draft.pending ? 'saving' : 'saveRevision'));
      submit.type = 'submit';
      const cancel = button(t('discardEdit'), () => {
        drafts.delete(key);
        draw();
        area.querySelector('button')?.focus();
      });
      const changed = () => draft.text !== record.data.text || draft.creativeRationale !== record.data.creativeRationale;
      const canSave = () => !draft.pending && !draft.conflict && latest.version === record.version &&
        draft.text.trim() && draft.creativeRationale.trim() && changed();
      const hint = el('p', 'x-meta', t(api.editScope === 'session' ? 'localRevision' : 'originalRetained'));
      form.append(hint);
      for (const name of ['text', 'creativeRationale']) {
        const label = el('label', 'x-edit-field', t(name === 'text' ? 'promptText' : name));
        const input = el('textarea', 'x-input');
        input.name = name;
        input.maxLength = name === 'text' ? 16000 : 4000;
        input.required = true;
        input.value = draft[name];
        input.rows = name === 'text' ? 4 : 2;
        input.readOnly = Boolean(draft.pending);
        input.addEventListener('input', () => {
          draft[name] = input.value;
          submit.disabled = !canSave();
        });
        inputs[name] = input;
        label.append(input);
        form.append(label);
      }
      const actions = el('div', 'x-actions');
      submit.disabled = !canSave();
      cancel.disabled = Boolean(draft.pending);
      actions.append(submit, cancel);
      form.append(actions);
      if (draft.error || draft.conflict || latest.version !== record.version) {
        const feedback = el('p', 'x-edit-error', draft.conflict || latest.version !== record.version ? t('versionConflict') : draft.error);
        feedback.setAttribute('role', 'alert');
        form.append(feedback);
      }
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!canSave()) return;
        draft.pending = true;
        draft.error = '';
        submit.disabled = cancel.disabled = true;
        submit.textContent = t('saving');
        for (const input of Object.values(inputs)) input.readOnly = true;
        let saved;
        try {
          saved = await api.editPrompt({
            id: record.id, expectedVersion: record.version, text: draft.text, creativeRationale: draft.creativeRationale,
          });
        } catch (error) {
          draft.pending = false;
          draft.conflict = /VERSION_CONFLICT/i.test(String(error.code) + ' ' + String(error.message));
          draft.error = t('saveFailed') + ' · ' + (error.message || String(error));
          if (activeEditor?.key === key && activeEditor.area.isConnected) {
            activeEditor.draw();
            const alert = activeEditor.area.querySelector('[role=alert]');
            alert?.setAttribute('tabindex', '-1');
            alert?.focus();
          }
          return;
        }
        drafts.delete(key);
        await afterSave(record, saved);
      });
      area.append(form);
    }
    draw();
  };
}
