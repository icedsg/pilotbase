import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

// @monaco-editor/react fetches Monaco from a CDN by default. The desktop
// build's Electron session blocks all non-local requests, which left the
// editor stuck on Monaco's own "Loading..." placeholder forever. Bundling
// monaco-editor and its workers ourselves keeps everything same-origin.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })
