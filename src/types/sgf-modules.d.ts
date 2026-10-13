declare module '@sabaki/sgf' {
  export interface SgfNode { id: string | number; parentId: string | number | null; data: Record<string, string[]>; children: SgfNode[] }
  export function parse(text: string, options?: { getId?: () => string }): SgfNode[]
  export function stringify(nodes: SgfNode[]): string
  export function parseVertex(value: string): [number, number]
  export function stringifyVertex(vertex: [number, number]): string
  export function parseCompressedVertices(value: string): Array<[number, number]>
  export function tokenizeIter(contents: string): Iterable<{ type: string; value: string }>
  const sgf: { parse: typeof parse; stringify: typeof stringify; parseVertex: typeof parseVertex; stringifyVertex: typeof stringifyVertex; parseCompressedVertices: typeof parseCompressedVertices; tokenizeIter: typeof tokenizeIter }
  export default sgf
}
declare module '@sabaki/go-board' {
  export default class Board {
    constructor(signMap?: number[][])
    static fromDimensions(width: number, height?: number): Board
    signMap: number[][]
    set(vertex: [number, number], sign: number): Board
    get(vertex: [number, number]): number
    clone(): Board
    makeMove(sign: number, vertex: [number, number], options?: { preventOverwrite?: boolean; preventSuicide?: boolean; preventKo?: boolean }): Board
    getCaptures(sign: number): number
    setCaptures(sign: number, captures: number): Board
    analyzeMove(sign: number, vertex: [number, number]): { overwrite: boolean; suicide: boolean }
  }
}
