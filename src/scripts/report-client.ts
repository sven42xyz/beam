import { apiErrorMessage, type Dict } from '../i18n';
import { AUTO_BLOCK_CATEGORIES, type ReportCategory } from '../shared/moderation';

/**
 * "Report content" dialog. Works on every room view, including the lock screen
 * of an encrypted room, because reporting only needs the room code. The list of
 * items is read from the page when the dialog opens; only the item ID is sent,
 * never a file name or any content.
 */
export function initReport(code: string, t: Dict) {
  const dialog = document.getElementById('report-dialog') as HTMLDialogElement | null;
  if (!dialog) return;
  const form = document.getElementById('report-form') as HTMLFormElement;
  const done = document.getElementById('report-done')!;
  // `as unknown as`: the Workers types (HTMLRewriter) clash with some DOM element types
  const itemSelect = document.getElementById('report-item') as unknown as HTMLSelectElement;
  const errorEl = document.getElementById('report-error')!;
  const submit = document.getElementById('report-submit') as HTMLButtonElement;
  const field = <T>(id: string) => document.getElementById(id) as unknown as T;

  function fillItems() {
    itemSelect.length = 1; // keep only "whole room"
    document.querySelectorAll<HTMLElement>('#items .item').forEach((li, i) => {
      // Files: just the name (the body also holds the type badge and size)
      const label = ((li.querySelector('.file-name') ?? li.querySelector('.item-body'))?.textContent ?? '').trim().slice(0, 60);
      itemSelect.add(new Option(`${i + 1}. ${label || '…'}`, li.dataset.id ?? ''));
    });
  }

  document.getElementById('report-open')?.addEventListener('click', () => {
    fillItems();
    form.hidden = false;
    done.hidden = true;
    errorEl.hidden = true;
    dialog.showModal();
  });
  document.getElementById('report-cancel')?.addEventListener('click', () => dialog.close());
  document.getElementById('report-close')?.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    errorEl.hidden = true;
    const category = field<HTMLSelectElement>('report-category').value;
    try {
      const res = await fetch(`/api/rooms/${code}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          itemId: itemSelect.value || undefined,
          description: field<HTMLTextAreaElement>('report-description').value,
          contact: field<HTMLInputElement>('report-contact').value || undefined,
          goodFaith: field<HTMLInputElement>('report-goodfaith').checked,
        }),
      });
      const data = (await res.json()) as { id?: string; blocked?: boolean; error?: string };
      if (!res.ok) throw new Error(apiErrorMessage(t, data.error, res.status));

      form.reset();
      form.hidden = true;
      done.hidden = false;
      document.getElementById('report-done-text')!.textContent =
        t.room.reportThanks(data.id ?? '') + (data.blocked ? ` ${t.room.reportBlocked}` : '');
      document.getElementById('report-done-csam')!.hidden = !AUTO_BLOCK_CATEGORIES.includes(category as ReportCategory);
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : t.errors.generic(0);
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}
