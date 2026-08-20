import MindMap from 'simple-mind-map/index.js';
import Drag from 'simple-mind-map/src/plugins/Drag.js';
import Select from 'simple-mind-map/src/plugins/Select.js';
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js';
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js';
import Export from 'simple-mind-map/src/plugins/Export.js';
import Watermark from 'simple-mind-map/src/plugins/Watermark.js';
import MiniMap from 'simple-mind-map/src/plugins/MiniMap.js';
MindMap.usePlugin(Drag)
    .usePlugin(Select)
    .usePlugin(KeyboardNavigation)
    .usePlugin(ExportXMind)
    .usePlugin(Export)
    .usePlugin(Watermark)
    .usePlugin(MiniMap);
export default MindMap;
