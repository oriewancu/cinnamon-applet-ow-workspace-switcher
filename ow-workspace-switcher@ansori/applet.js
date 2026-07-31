const Applet = imports.ui.applet;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Settings = imports.ui.settings;
const Cinnamon = imports.gi.Cinnamon;

class OWWorkspaceSwitcher extends Applet.Applet {
    constructor(metadata, orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        // Bind Settings
        this.settings = new Settings.AppletSettings(this, metadata.uuid, instance_id);
        this.settings.bind("theme", "theme", this.refreshApplet);
        this.settings.bind("overview_mode", "overview_mode", this.refreshApplet);
        this.settings.bind("show_indicator", "show_indicator", this.refreshApplet);
        this.settings.bind("indicator_style", "indicator_style", this.refreshApplet);
        
        // Bind Custom Size Settings
        this.settings.bind("use_custom_size", "use_custom_size", this.refreshApplet);
        this.settings.bind("custom_height", "custom_height", this.refreshApplet);
        this.settings.bind("custom_width", "custom_width", this.refreshApplet);

        // Listen to Desktop Background changes
        this.bgSettings = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.background' });
        this.bgSettingsId = this.bgSettings.connect('changed::picture-uri', () => this.refreshApplet());

        this.wm = global.workspace_manager;
        
        this.wmSignals = [];
        this.displaySignals = [];
        this.wsSignals = [];
        
        // Main UI Container
        this.mainBox = new St.BoxLayout();
        this.actor.add(this.mainBox);

        this._connectSignals();
        this.refreshApplet();
    }

    _connectSignals() {
        this.wmSignals.push(this.wm.connect('notify::n-workspaces', () => this._onWorkspacesChanged()));
        this.wmSignals.push(this.wm.connect('workspace-switched', () => this.refreshApplet()));
        
        this.displaySignals.push(global.display.connect('notify::focus-window', () => this.refreshApplet()));
        this.displaySignals.push(global.display.connect('restacked', () => this.refreshApplet()));

        this._connectWorkspaceSignals();
    }

    _connectWorkspaceSignals() {
        this._disconnectWorkspaceSignals();
        for (let i = 0; i < this.wm.n_workspaces; i++) {
            let ws = this.wm.get_workspace_by_index(i);
            this.wsSignals.push({ ws: ws, id: ws.connect('window-added', () => this.refreshApplet()) });
            this.wsSignals.push({ ws: ws, id: ws.connect('window-removed', () => this.refreshApplet()) });
        }
    }

    _disconnectWorkspaceSignals() {
        if (this.wsSignals) {
            for (let s of this.wsSignals) {
                s.ws.disconnect(s.id);
            }
        }
        this.wsSignals = [];
    }

    _onWorkspacesChanged() {
        this._connectWorkspaceSignals();
        this.refreshApplet();
    }

    refreshApplet() {
        this.mainBox.destroy_all_children();
        
        // Update Theme Class on main container
        this.mainBox.style_class = `ow-workspace-switcher ow-workspace-switcher-${this.theme}`;

        // Get Desktop Background URI
        let bgUri = this.bgSettings.get_string('picture-uri');
        let activeIndex = this.wm.get_active_workspace_index();

        for (let i = 0; i < this.wm.n_workspaces; i++) {
            let isActive = (i === activeIndex);
            let item = this._createWorkspaceItem(i, isActive, bgUri);
            this.mainBox.add_child(item);
        }
    }

    _createWorkspaceItem(index, isActive, bgUri) {
        // Button to switch workspace
        let button = new St.Button({ reactive: true, can_focus: true });
        button.connect('clicked', () => {
            let ws = this.wm.get_workspace_by_index(index);
            if (ws) ws.activate(global.get_current_time());
        });

        // Vertical wrapper for box + indicator
        let wrapper = new St.BoxLayout({ vertical: true, style_class: 'ow-ws-wrapper' });
        
        let box = new St.Bin({ style_class: `ow-ws-box ow-ws-box-${this.theme}` });
        if (isActive) box.add_style_class_name('ow-ws-box-active');

        if (!this.show_indicator) {
            box.add_style_class_name('ow-ws-box-no-indicator');
        }

        // LAPISAN 1: DIMMER 
        let dimmerBin = new St.Bin({ style_class: 'ow-ws-dimmer', x_fill: true, y_fill: true });

        // LAPISAN 2: CENTER BIN
        let centerBin = new St.Bin({ x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE, x_fill: true, y_fill: true });

        // Menyimpan semua inline CSS agar bisa diterapkan sekaligus
        let boxStyle = "";

        // Jika opsi manual size diaktifkan, sesuaikan dengan status indikator
        if (this.use_custom_size) {
            if (this.show_indicator) {
                // Ukuran saat indikator TAMPIL
                boxStyle += `height: ${this.custom_height}px; width: ${this.custom_width}px; `;
            } else {
                // Ukuran saat indikator SEMBUNYI
                boxStyle += `height: ${this.custom_height_no_indicator}px; width: ${this.custom_width_no_indicator}px; `;
            }
        }

        // Jika opsi manual size diaktifkan
        if (this.use_custom_size) {
            boxStyle += `height: ${this.custom_height}px; width: ${this.custom_width}px; `;
        }

        if (this.overview_mode) {
            if (bgUri) {
                boxStyle += `background-image: url("${bgUri}"); background-size: cover; background-position: center;`;
            } else {
                dimmerBin.remove_style_class_name('ow-ws-dimmer');
            }
            
            let ws = this.wm.get_workspace_by_index(index);
            let windows = ws.list_windows();
            
            let validWindows = windows.filter(w => 
                !w.is_skip_taskbar() && 
                w.window_type !== Meta.WindowType.DESKTOP && 
                !w.minimized
            );
            
            if (validWindows.length > 0) {
                let sortedWindows = global.display.sort_windows_by_stacking(validWindows);
                let topmostWin = sortedWindows[sortedWindows.length - 1]; 
                
                let tracker = Cinnamon.WindowTracker.get_default();
                let app = tracker.get_window_app(topmostWin);
                if (app) {
                    let icon = app.create_icon_texture(16); 
                    centerBin.set_child(icon);
                }
            }
        } else {
            dimmerBin.remove_style_class_name('ow-ws-dimmer');
            let label = new St.Label({ text: (index + 1).toString(), style_class: `ow-ws-label ow-ws-label-${this.theme}` });
            centerBin.set_child(label);
        }

        // Terapkan semua inline styles secara bersamaan (kustom height/width dan background)
        if (boxStyle !== "") {
            box.set_style(boxStyle);
        }

        dimmerBin.set_child(centerBin);
        box.set_child(dimmerBin);
        wrapper.add_child(box);

        // LOGIC INDIKATOR BARU
        if (this.show_indicator) {
            let indicatorArea = new St.Bin({ style_class: 'ow-ws-indicator-area', x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
            
            if (isActive) {
                let indicatorWidget;
                
                if (this.indicator_style === 'triangle') {
                    indicatorWidget = new St.Label({ 
                        text: '▲', 
                        style_class: `ow-ws-triangle-${this.theme}` 
                    });
                } else if (this.indicator_style === 'circle_filled') {
                    indicatorWidget = new St.Bin({ style_class: `ow-ws-circle-filled-${this.theme}` });
                } else if (this.indicator_style === 'circle_empty') {
                    indicatorWidget = new St.Bin({ style_class: `ow-ws-circle-empty-${this.theme}` });
                }

                indicatorArea.set_child(indicatorWidget);
            }
            wrapper.add_child(indicatorArea);
        }

        button.set_child(wrapper);
        return button;
    }

    on_applet_removed_from_panel() {
        if (this.bgSettingsId) {
            this.bgSettings.disconnect(this.bgSettingsId);
        }
        for (let s of this.wmSignals) {
            this.wm.disconnect(s);
        }
        for (let s of this.displaySignals) {
            global.display.disconnect(s);
        }
        this._disconnectWorkspaceSignals();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new OWWorkspaceSwitcher(metadata, orientation, panel_height, instance_id);
}
