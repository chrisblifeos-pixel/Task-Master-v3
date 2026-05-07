const { Plugin, ItemView, Modal, TFile, Setting } = require('obsidian');

const VIEW_TYPE = "task-master-view";
const FOLDER_PATH = "_system/Tasks";

class TaskMasterView extends ItemView {
    constructor(leaf) { super(leaf); }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return "Task Master"; }
    getIcon() { return "check-circle"; }

    async onOpen() { 
        this.refresh(); 
        this.registerEvent(this.app.vault.on("modify", () => this.refresh()));
        this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    }

    async refresh() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("tm-container");

        container.createDiv({ cls: "tm-header", text: "Task Master" });
        const listEl = container.createDiv({ cls: "tm-list" });

        if (!await this.app.vault.adapter.exists(FOLDER_PATH)) {
            await this.app.vault.createFolder(FOLDER_PATH);
        }

        const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(FOLDER_PATH));
        const tasks = await Promise.all(files.map(async f => {
            const cache = this.app.metadataCache.getFileCache(f);
            return { file: f, fm: cache?.frontmatter || {} };
        }));

        // Sorting: Active (by High Priority first) then Completed at bottom
        tasks.sort((a, b) => {
            if (a.fm.completed !== b.fm.completed) return a.fm.completed ? 1 : -1;
            const pMap = { "High": 1, "Medium": 2, "Low": 3, "None": 4 };
            return (pMap[a.fm.priority] || 4) - (pMap[b.fm.priority] || 4);
        });

        tasks.forEach(task => {
            const isDone = task.fm.completed === true;
            const card = listEl.createDiv({ cls: `tm-task-card ${isDone ? 'is-completed' : ''}` });
            const row = card.createDiv({ cls: "tm-card-row" });

            const cb = row.createEl("input", { type: "checkbox" });
            cb.checked = isDone;
            cb.onclick = async (e) => {
                e.stopPropagation();
                await this.app.fileManager.processFrontMatter(task.file, fm => { fm.completed = cb.checked; });
                this.refresh();
            };

            const info = row.createDiv({ cls: "tm-info" });
            
            // Priority Tag in List
            if (task.fm.priority && task.fm.priority !== "None") {
                info.createDiv({ 
                    cls: `tm-priority-tag tm-p-${task.fm.priority.toLowerCase()}`, 
                    text: task.fm.priority 
                });
            }

            info.createDiv({ cls: "tm-title", text: task.file.basename });
            
            const meta = info.createDiv({ cls: "tm-meta", attr: { style: "font-size: 0.75em; color: var(--text-muted);" } });
            if (task.fm.due) meta.createEl("span", { text: `📅 ${task.fm.due}  ` });
            if (task.fm.location) meta.createEl("span", { text: `📍 ${task.fm.location}` });

            card.onclick = () => new TaskFormModal(this.app, task, () => this.refresh()).open();
        });

        const fab = container.createDiv({ cls: "tm-fab", text: "+" });
        fab.onclick = () => new TaskFormModal(this.app, null, () => this.refresh()).open();
    }
}

class TaskFormModal extends Modal {
    constructor(app, task, onSave) {
        super(app);
        this.task = task;
        this.onSave = onSave;
        this.subtasks = task?.fm?.subtasks ? [...task.fm.subtasks] : [];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("tm-modal");
        const fm = this.task?.fm || {};

        contentEl.createEl("h2", { text: this.task ? "Task Details" : "New Task" });

        // Task Name
        const nameGrp = contentEl.createDiv({ cls: "tm-form-group" });
        nameGrp.createEl("label", { text: "Task Name" });
        const titleInp = nameGrp.createEl("input", { cls: "tm-input-full", type: "text", value: this.task ? this.task.file.basename : "" });

        // Description
        const descGrp = contentEl.createDiv({ cls: "tm-form-group" });
        descGrp.createEl("label", { text: "Description & Attachments" });
        const descInp = descGrp.createEl("textarea", { cls: "tm-input-full", attr: { style: "height: 80px;" }, placeholder: "Describe task or link [[files]]..." });
        if (this.task) this.app.vault.read(this.task.file).then(c => descInp.value = c.split('---').pop().trim());

        // Grid for Formal Fields
        const grid = contentEl.createDiv({ cls: "tm-grid" });

        const createField = (label, type, val, placeholder = "") => {
            const grp = grid.createDiv({ cls: "tm-form-group" });
            grp.createEl("label", { text: label });
            return grp.createEl("input", { type, value: val, placeholder, cls: "tm-input-full" });
        };

        const startInp = createField("Start Date", "date", fm.start || "");
        const endInp = createField("End Date", "date", fm.end || "");
        const dueInp = createField("Due Date", "date", fm.due || "");
        const locInp = createField("Location", "text", fm.location || "", "e.g. Home, Office");

        const prioGrp = grid.createDiv({ cls: "tm-form-group tm-span-2" });
        prioGrp.createEl("label", { text: "Priority Level" });
        const prioSel = prioGrp.createEl("select", { cls: "tm-input-full" });
        ["None", "Low", "Medium", "High"].forEach(p => {
            const o = prioSel.createEl("option", { text: p, value: p });
            if (fm.priority === p) o.selected = true;
        });

        // Sub-tasks Section
        contentEl.createEl("h3", { text: "Sub-tasks", attr: { style: "margin-top: 20px;" } });
        const subList = contentEl.createDiv();
        const renderSubs = () => {
            subList.empty();
            this.subtasks.forEach((s, i) => {
                const row = subList.createDiv({ cls: "tm-subtask-item" });
                const scb = row.createEl("input", { type: "checkbox" });
                scb.checked = s.completed;
                scb.onclick = () => s.completed = scb.checked;
                const sinp = row.createEl("input", { cls: "tm-sub-input", type: "text", value: s.text });
                sinp.onchange = () => s.text = sinp.value;
                const del = row.createEl("button", { text: "✕", cls: "mod-warning" });
                del.onclick = () => { this.subtasks.splice(i, 1); renderSubs(); };
            });
            const addBtn = subList.createEl("button", { text: "+ Add Sub-task", cls: "mod-cta", attr: { style: "margin-top: 10px;" } });
            addBtn.onclick = () => { this.subtasks.push({ text: "", completed: false }); renderSubs(); };
        };
        renderSubs();

        // Footer Actions
        const footer = contentEl.createDiv({ attr: { style: "margin-top: 30px; display: flex; gap: 10px;" } });
        const save = footer.createEl("button", { text: "Save Changes", cls: "mod-cta" });
        save.onclick = async () => {
            const name = titleInp.value || "Untitled";
            const path = `${FOLDER_PATH}/${name.replace(/[\\/:*?"<>|]/g, '-')}.md`;
            const subYaml = this.subtasks.map(s => `  - text: "${s.text.replace(/"/g, '\\"')}"\n    completed: ${s.completed}`).join('\n');
            const content = `---\ncompleted: ${fm.completed || false}\npriority: ${prioSel.value}\nstart: ${startInp.value}\nend: ${endInp.value}\ndue: ${dueInp.value}\nlocation: "${locInp.value}"\nsubtasks:\n${subYaml}\n---\n\n${descInp.value}`;

            if (this.task) {
                await this.app.vault.modify(this.task.file, content);
                if (this.task.file.basename !== name) await this.app.fileManager.renameFile(this.task.file, path);
            } else {
                await this.app.vault.create(path, content);
            }
            this.onSave();
            this.close();
        };

        if (this.task) {
            const del = footer.createEl("button", { text: "Delete Task", cls: "mod-warning" });
            del.onclick = async () => { await this.app.vault.delete(this.task.file); this.onSave(); this.close(); };
        }
    }
}

module.exports = class TaskMasterPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE, (leaf) => new TaskMasterView(leaf));
        this.addRibbonIcon("check-circle", "Task Master", () => this.activateView());
    }

    async activateView() {
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            const rightLeaf = this.app.workspace.getRightLeaf(false);
            await rightLeaf.setViewState({ type: VIEW_TYPE, active: true });
            leaf = rightLeaf;
        }
        this.app.workspace.revealLeaf(leaf);
    }
};