import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createRoom, joinRoom, leaveRoom, listenLanEvents, scanRooms, sendCommand, type LanDiscoveredRoom, type LanEnvelope, type LanRoomConfig, type LanRoomInfo } from '../services/lan'
import type { GameSnapshot, Stone } from '../types/game'
import { useGameStore } from './game'

export const useLanStore = defineStore('lan', () => {
  const game = useGameStore()
  const room = ref<LanRoomInfo | null>(null)
  const currentSnapshot = ref<GameSnapshot | null>(null)
  const status = ref<'idle' | 'connecting' | 'waiting' | 'ready' | 'playing' | 'ended' | 'reconnecting' | 'closed'>('idle')
  const error = ref('')
  const connected = ref(false)
  const lastSequence = ref(0)
  const rooms = ref<LanDiscoveredRoom[]>([])
  const connectionTarget = ref<{ host: string; port: number } | null>(null)
  const reconnectRemaining = ref<number | null>(null)
  const resumeRoom = ref<{ sessionId: string; host: string; port: number } | null>(loadSavedResumeRoom())
  const pendingUndoRequest = ref<{ requestId: string; requester: Stone } | null>(null)
  const undoConsentRemaining = ref<number | null>(null)
  const undoWaitingRemaining = ref<number | null>(null)
  const undoWaiting = ref(false)
  let stopListening: (() => void) | undefined
  let reconnectTimer: ReturnType<typeof setInterval> | undefined
  let undoConsentTimer: ReturnType<typeof setInterval> | undefined
  let undoWaitingTimer: ReturnType<typeof setInterval> | undefined

  function resumeKey(sessionId: string) {
    return `lan.resume.${sessionId}`
  }

  function loadSavedResumeRoom() {
    try {
      const value = JSON.parse(window.localStorage.getItem('lan.resume.room') ?? 'null') as Partial<{ sessionId: string; host: string; port: number }> | null
      if (value?.sessionId && value.host && value.port) return { sessionId: value.sessionId, host: value.host, port: value.port }
    } catch { /* storage is optional */ }
    return null
  }

  function saveResumeRoom(value: { sessionId: string; host: string; port: number }) {
    if (!value.sessionId || !value.host || !value.port) return
    resumeRoom.value = value
    try { window.localStorage.setItem('lan.resume.room', JSON.stringify(value)) } catch { /* storage is optional */ }
  }

  function loadResumeToken(sessionId: string) {
    try { return window.localStorage.getItem(resumeKey(sessionId)) ?? '' } catch { return '' }
  }

  function saveResumeToken(sessionId: string, token: string) {
    if (!sessionId || !token) return
    try { window.localStorage.setItem(resumeKey(sessionId), token) } catch { /* storage is optional */ }
  }

  function clearReconnectTimer() {
    reconnectRemaining.value = null
    if (reconnectTimer) clearInterval(reconnectTimer)
    reconnectTimer = undefined
  }

  function startReconnectTimer() {
    clearReconnectTimer()
    reconnectRemaining.value = 90
    reconnectTimer = setInterval(() => {
      if (reconnectRemaining.value === null) return
      reconnectRemaining.value = Math.max(0, reconnectRemaining.value - 1)
      if (reconnectRemaining.value === 0) clearReconnectTimer()
    }, 1000)
  }

  function clearUndoConsentTimer() {
    undoConsentRemaining.value = null
    if (undoConsentTimer) clearInterval(undoConsentTimer)
    undoConsentTimer = undefined
  }

  function startUndoConsentTimer() {
    clearUndoConsentTimer()
    undoConsentRemaining.value = 10
    undoConsentTimer = setInterval(() => {
      if (undoConsentRemaining.value === null) return
      undoConsentRemaining.value = Math.max(0, undoConsentRemaining.value - 1)
      if (undoConsentRemaining.value === 0) {
        clearUndoConsentTimer()
        void respondUndo(false)
      }
    }, 1000)
  }

  function clearUndoWaitingTimer() {
    undoWaitingRemaining.value = null
    if (undoWaitingTimer) clearInterval(undoWaitingTimer)
    undoWaitingTimer = undefined
  }

  function startUndoWaitingTimer() {
    clearUndoWaitingTimer()
    undoWaitingRemaining.value = 10
    undoWaitingTimer = setInterval(() => {
      if (undoWaitingRemaining.value === null) return
      undoWaitingRemaining.value = Math.max(0, undoWaitingRemaining.value - 1)
      if (undoWaitingRemaining.value === 0) clearUndoWaitingTimer()
    }, 1000)
  }

  const isHost = computed(() => room.value?.role === 'host')
  const localStone = computed(() => {
    if (!room.value) return null
    return room.value.config.hostColor === (room.value.role === 'host' ? 'black' : 'white')
      ? 'black'
      : 'white'
  })

  function applySnapshot(snapshot: GameSnapshot) {
    error.value = ''
    currentSnapshot.value = snapshot
    game.loadSnapshot(snapshot)
    status.value = snapshot.status === 'finished' ? 'ended' : 'playing'
  }

  function handleEvent(event: LanEnvelope) {
    // Events from an old socket must not overwrite a newer room session.
    if (room.value?.sessionId && event.sessionId && event.sessionId !== room.value.sessionId && event.type !== 'welcome') return
    lastSequence.value = Math.max(lastSequence.value, event.sequence)
    if (event.type === 'room_state') {
      const info = event.payload as unknown as LanRoomInfo
      const role = room.value?.role ?? info.role
      const previous = room.value
      room.value = {
        ...info,
        role,
        password: role === 'client' ? previous?.password ?? info.password : info.password,
        addresses: role === 'client' && previous?.addresses.length ? previous.addresses : info.addresses,
        gameNumber: info.gameNumber ?? room.value?.gameNumber ?? 1,
        reconnectable: info.reconnectable ?? false,
      }
      // Connection state must not override the game phase. A resumed room is
      // still playable when both peers are connected and the game is active.
      connected.value = role === 'client' || info.clientConnected
      if (connected.value || !info.reconnectable) clearReconnectTimer()
      if (info.started && info.clientConnected) {
        status.value = 'playing'
      } else if (info.started && info.reconnectable) {
        status.value = 'reconnecting'
      } else if (info.clientConnected || role === 'client') {
        status.value = 'ready'
      } else {
        status.value = 'waiting'
      }
      return
    }
    if (event.type === 'welcome') {
      error.value = ''
      connected.value = true
      clearReconnectTimer()
      status.value = 'ready'
      const config = event.payload.config as LanRoomInfo['config'] | undefined
      const reconnectToken = String(event.payload.reconnectToken ?? '')
      saveResumeToken(event.sessionId, reconnectToken)
      room.value = {
        sessionId: event.sessionId,
        role: 'client',
        password: room.value?.password ?? '',
        port: room.value?.port ?? 0,
        addresses: room.value?.addresses ?? [],
        passwordMode: room.value?.passwordMode ?? 'generated',
        config: config ?? room.value?.config ?? {
          boardSize: 19,
          ruleSet: 'chinese',
          hostColor: 'black',
          handicap: 0,
          komi: 3.75,
          komiUnit: '子',
          timeControl: { preset: 'untimed', mainTimeSeconds: 0, byoYomiSeconds: 0, byoYomiPeriods: 0 },
        },
        clientConnected: true,
        started: Boolean(event.payload.resuming),
        gameNumber: Number(event.payload.gameNumber ?? 1),
        reconnectable: false,
      }
      if (connectionTarget.value) saveResumeRoom({ sessionId: event.sessionId, ...connectionTarget.value })
      status.value = event.payload.resuming ? 'playing' : 'ready'
      return
    }
    if (event.type === 'game_started' || event.type === 'move_applied' || event.type === 'pass_applied' || event.type === 'undo_applied' || event.type === 'game_ended') {
      if (event.type === 'undo_applied') {
        pendingUndoRequest.value = null
        undoWaiting.value = false
        clearUndoConsentTimer()
        clearUndoWaitingTimer()
      }
      if (room.value) room.value.started = event.type !== 'game_ended'
      const snapshot = event.payload.snapshot as GameSnapshot | undefined
      if (snapshot) applySnapshot(snapshot)
      if (event.type === 'game_ended' && room.value) {
        room.value.started = false
        status.value = 'ended'
        clearReconnectTimer()
      }
      return
    }
    if (event.type === 'undo_requested') {
      const requester = event.payload.requester === 'white' ? 'white' : 'black'
      const requestId = String(event.payload.requestId ?? '')
      if (!requestId) return
      if (requester === localStone.value) {
        undoWaiting.value = true
      } else {
        pendingUndoRequest.value = { requestId, requester }
        startUndoConsentTimer()
      }
      return
    }
    if (event.type === 'undo_rejected') {
      pendingUndoRequest.value = null
      undoWaiting.value = false
      clearUndoConsentTimer()
      clearUndoWaitingTimer()
      error.value = String(event.payload.message ?? '对方拒绝了悔棋请求')
      return
    }
    if (event.type === 'error') {
      undoWaiting.value = false
      clearUndoConsentTimer()
      clearUndoWaitingTimer()
      error.value = String(event.payload.message ?? '局域网操作失败')
      return
    }
    if (event.type === 'disconnected') {
      connected.value = false
      pendingUndoRequest.value = null
      undoWaiting.value = false
      clearUndoConsentTimer()
      clearUndoWaitingTimer()
      if (room.value) room.value.clientConnected = false
      const reason = typeof event.payload?.reason === 'string' ? event.payload.reason : ''
      error.value = reason ? `局域网连接已断开（${reason}）` : '局域网连接已断开'
      if (status.value !== 'closed' && (room.value?.started || status.value === 'playing' || status.value === 'ready')) {
        status.value = 'reconnecting'
        startReconnectTimer()
      }
      return
    }
    if (event.type === 'closed') {
      connected.value = false
      status.value = 'closed'
      clearReconnectTimer()
      clearUndoConsentTimer()
      clearUndoWaitingTimer()
    }
  }

  async function initialize() {
    if (stopListening) return
    stopListening = await listenLanEvents(handleEvent)
  }

  async function create(config: LanRoomConfig, password = '') {
    await initialize()
    error.value = ''
    status.value = 'connecting'
    room.value = await createRoom(config, password)
    // Creating a listener is not the same as having a peer connected.
    connected.value = false
    clearReconnectTimer()
    clearUndoConsentTimer()
    resumeRoom.value = null
    status.value = 'waiting'
  }

  async function join(host: string, port: number, password: string, sessionId?: string, token?: string) {
    await initialize()
    error.value = ''
    status.value = 'connecting'
    // Set this before the native command returns. The handshake can finish
    // immediately, otherwise a late assignment could overwrite `true`.
    connected.value = false
    clearReconnectTimer()
    connectionTarget.value = { host, port }
    const targetSessionId = sessionId ?? room.value?.sessionId
    const reconnectToken = token ?? (targetSessionId ? loadResumeToken(targetSessionId) : '')
    room.value = {
      sessionId: targetSessionId ?? '',
      role: 'client',
      password,
      passwordMode: password ? 'custom' : 'none',
      port,
      addresses: [host],
      config: room.value?.config ?? {
        boardSize: 19,
        ruleSet: 'chinese',
        hostColor: 'black',
        handicap: 0,
        komi: 3.75,
        komiUnit: '子',
        timeControl: { preset: 'untimed', mainTimeSeconds: 0, byoYomiSeconds: 0, byoYomiPeriods: 0 },
      },
      clientConnected: false,
      started: false,
      gameNumber: room.value?.gameNumber ?? 1,
      reconnectable: false,
    }
    if (targetSessionId) saveResumeRoom({ sessionId: targetSessionId, host, port })
    await joinRoom(host, port, password, targetSessionId, reconnectToken)
  }

  async function reconnect() {
    if (room.value?.role !== 'client' || !connectionTarget.value) throw new Error('没有可恢复的局域网房间')
    const target = connectionTarget.value
    const sessionId = room.value.sessionId
    const token = loadResumeToken(sessionId)
    await leaveRoom()
    connected.value = false
    status.value = 'connecting'
    clearReconnectTimer()
    await joinRoom(target.host, target.port, room.value.password, sessionId, token)
  }

  async function refreshRooms() {
    rooms.value = await scanRooms()
    return rooms.value
  }

  async function leaveToLobby() {
    if (room.value?.role !== 'client') return leave()
    if (room.value.sessionId && connectionTarget.value) {
      saveResumeRoom({ sessionId: room.value.sessionId, ...connectionTarget.value })
    }
    await leaveRoom()
    room.value = null
    currentSnapshot.value = null
    connected.value = false
    status.value = 'idle'
    clearReconnectTimer()
  }

  async function command(type: string, payload: Record<string, unknown> = {}) {
    error.value = ''
    await sendCommand(type, payload)
  }

  async function startGame() { await command('start_game') }
  async function submitMove(row: number, col: number) { await command('submit_move', { row, col }) }
  async function submitPass() { await command('submit_pass') }
  async function requestUndo() {
    if (undoWaiting.value || pendingUndoRequest.value) return
    undoWaiting.value = true
    startUndoWaitingTimer()
    try {
      await command('request_undo')
    } catch (error) {
      undoWaiting.value = false
      clearUndoWaitingTimer()
      throw error
    }
  }
  async function respondUndo(approved: boolean) {
    const request = pendingUndoRequest.value
    if (!request) return
    pendingUndoRequest.value = null
    clearUndoConsentTimer()
    try {
      await command('respond_undo', { requestId: request.requestId, approved })
    } catch (error) {
      pendingUndoRequest.value = request
      throw error
    }
  }
  async function resign() { await command('resign') }

  async function leave() {
    if (room.value?.role === 'client' && room.value.sessionId) {
      saveResumeToken(room.value.sessionId, loadResumeToken(room.value.sessionId))
    }
    await leaveRoom()
    room.value = null
    currentSnapshot.value = null
    connected.value = false
    status.value = 'idle'
    clearReconnectTimer()
    stopListening?.()
    stopListening = undefined
  }

  return { room, currentSnapshot, status, error, connected, lastSequence, rooms, reconnectRemaining, resumeRoom, pendingUndoRequest, undoConsentRemaining, undoWaitingRemaining, undoWaiting, isHost, localStone, initialize, create, join, reconnect, refreshRooms, leaveToLobby, command, startGame, submitMove, submitPass, requestUndo, respondUndo, resign, leave }
})
