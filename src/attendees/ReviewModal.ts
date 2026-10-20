import { App, ButtonComponent, Modal, Setting } from 'obsidian';
import type { QueuedPerson } from './planner';

export class ReviewModal extends Modal {
	private checked = new Set<string>();

	constructor(
		app: App,
		private queue: QueuedPerson[],
		private onSubmit: (selected: QueuedPerson[], unselected: QueuedPerson[]) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Fathom Sync: review attendees' });

		const collisions = this.queue.filter(q => q.kind === 'collision');
		const externals = this.queue.filter(q => q.kind === 'external');

		if (collisions.length) {
			contentEl.createEl('h3', { text: `Name collisions (${collisions.length})` });
			contentEl.createEl('p', {
				text: 'A contact file with this name already exists. Resolve by hand: if it is the same person, add this address to secondary_email on the existing record. These will be listed again next run.',
			});
			const ul = contentEl.createEl('ul');
			for (const q of collisions) {
				ul.createEl('li', {
					text: q.basename === ''
						? `<${q.email}> · no usable name`
						: `${q.basename} <${q.email}>${q.existingPath ? ` · existing: ${q.existingPath}` : ' · name used twice in this run'}`,
				});
			}
		}

		const IGNORE_LABEL = 'Create selected, ignore the rest';
		let confirming = false;
		let confirmingSince = 0;
		let ignoreBtn: ButtonComponent | undefined;

		if (externals.length) {
			contentEl.createEl('h3', { text: `Externals (${externals.length})` });
			contentEl.createEl('p', {
				text: 'Checked people become contacts. "Create selected" leaves everyone else to be asked again next backfill; "Create selected, ignore the rest" adds the unchecked people to the ignore list.',
			});
			for (const q of externals) {
				const meetings = `${q.meetings.length} meeting${q.meetings.length === 1 ? '' : 's'}`;
				new Setting(contentEl)
					.setName(`${q.basename}`)
					.setDesc(`${q.email} · ${q.org ?? q.domain} · ${meetings}`)
					.addToggle(t =>
						t.setValue(false).onChange(v => {
							if (v) this.checked.add(q.email);
							else this.checked.delete(q.email);
							// The ignore count just changed, so any pending confirmation is stale.
							confirming = false;
							ignoreBtn?.setButtonText(IGNORE_LABEL);
						}),
					);
			}
		}

		const buttons = new Setting(contentEl);
		if (externals.length) {
			const submit = async (ignoreRest: boolean) => {
				const selected = externals.filter(q => this.checked.has(q.email));
				const unselected = ignoreRest ? externals.filter(q => !this.checked.has(q.email)) : [];
				this.close();
				await this.onSubmit(selected, unselected);
			};
			buttons.addButton(b => b.setButtonText('Create selected').setCta().onClick(() => submit(false)));
			// Ignoring is permanent and can cover hundreds of people on a first backfill,
			// so it takes a second click that states the count.
			// onClick() adds a listener rather than replacing one, so confirm with a flag.
			buttons.addButton(b => {
				ignoreBtn = b;
				b
					.setButtonText(IGNORE_LABEL)
					.setWarning()
					.onClick(async () => {
						const rest = externals.length - this.checked.size;
						// Two fast clicks must not pass the confirmation: ignore a second click inside 400 ms.
						if (rest > 0 && confirming && Date.now() - confirmingSince < 400) return;
						if (rest > 0 && !confirming) {
							confirming = true;
							confirmingSince = Date.now();
							b.setButtonText(`Click again to ignore ${rest} ${rest === 1 ? 'person' : 'people'}`);
							return;
						}
						await submit(true);
					});
			});
		}
		buttons.addButton(b => b.setButtonText('Close without choosing').onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
