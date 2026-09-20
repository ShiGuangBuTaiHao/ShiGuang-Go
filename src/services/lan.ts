import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Handicap, RuleSet, TimeControl } from '../domain/gameSetup'

export type LanPasswordMode = 'generated' | 'custom' | 'none'

export interface LanRoomConfig {
  boardSize: 19
  ruleSet: RuleSet
  hostColor: 'black' | 'white'
  handicap: Handicap
  komi: number
  komiUnit: '子' | '目'
  timeControl: TimeControl
}

export interface LanRoomInfo {
  sessionId: string
  role: 'host' | 'client'
  password: string
  passwordMode: LanPasswordMode
  port: number
  addresses: string[]
  config: LanRoomConfig
  clientConnected: boolean
  started: boolean
  gameNumber: number
  reconnectable: boolean
}

export interface LanDiscoveredRoom {
  sessionId: string
  host: string
  port: number
  config: LanRoomConfig
  passwordRequired: boolean
  status: 'waiting' | 'ready' | 'playing' | 'reconnecting'
  reconnectable: boolean
  gameNumber: number
}

export interface LanEnvelope {
  protocolVersion: number
  sessionId: string
  messageId: string
  sequence: number
  type: string
  payload: Record<string, unknown>
}

function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function requireDesktop() {
  if (!isDesktopRuntime()) throw new Error('局域网对局需要在 Tauri 桌面端运行')
}

export async function getLocalAddresses(): Promise<string[]> {
  requireDesktop()
  return invoke<string[]>('lan_get_local_addresses')
}

export async function createRoom(config: LanRoomConfig, password = ''): Promise<LanRoomInfo> {
  requireDesktop()
  return invoke<LanRoomInfo>('lan_create_room', {
    config: { ...config, passwordMode: password.trim() ? 'custom' : 'none', password },
  })
}

export async function joinRoom(
  host: string,
  port: number,
  password: string,
  sessionId?: string,
  reconnectToken?: string,
): Promise<void> {
  requireDesktop()
  return invoke('lan_join_room', {
    request: { host, port, password, sessionId, reconnectToken },
  })
}

export async function scanRooms(): Promise<LanDiscoveredRoom[]> {
  requireDesktop()
  return invoke<LanDiscoveredRoom[]>('lan_scan_rooms')
}

export async function sendCommand(type: string, payload: Record<string, unknown> = {}): Promise<void> {
  requireDesktop()
  return invoke('lan_send_command', { request: { type, payload } })
}

export async function leaveRoom(): Promise<void> {
  requireDesktop()
  return invoke('lan_leave_room')
}

export function listenLanEvents(handler: (event: LanEnvelope) => void): Promise<UnlistenFn> {
  requireDesktop()
  return listen<LanEnvelope>('lan://event', (event) => handler(event.payload))
}
