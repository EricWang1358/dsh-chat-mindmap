declare module 'simple-mind-map/full.js' {
  interface MindMapInstance {
    doExport?: {
      export(type: string, download: boolean, name: string): Promise<unknown>
    }
    resize(): void
    destroy?(): void
  }
  const MindMap: new (options: {
    el: HTMLElement
    data: unknown
    layout: string
    readonly?: boolean
    fit?: boolean
  }) => MindMapInstance
  export default MindMap
}
