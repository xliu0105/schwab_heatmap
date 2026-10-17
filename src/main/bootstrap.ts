// Imported before anything that touches app paths (several modules read userData at load time).
import { app } from 'electron'

// Lets a second dev instance (e.g. demo mode) run beside the real one without sharing storage.
if (process.env.HEATMAP_USER_DATA) app.setPath('userData', process.env.HEATMAP_USER_DATA)
