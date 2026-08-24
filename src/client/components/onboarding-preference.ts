import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

export type OnboardingSettings = { onboardingSeen?: boolean }

/**
 * Keeps the first-use preference durable when DSH settings are available and
 * gracefully falls back to process memory when they are not. DSH Web may use
 * a different local port between launches, so browser storage is not a safe
 * persistence boundary for this preference.
 */
export class OnboardingPreference {
  private scope: SettingsScope<OnboardingSettings> | undefined
  private unsubscribe: (() => void) | undefined
  private readonly listeners = new Set<() => void>()
  private memorySeen = false
  private optimisticSeen: boolean | undefined

  get seen(): boolean {
    if (this.optimisticSeen !== undefined) return this.optimisticSeen
    const snapshot = this.scope?.getSnapshot()
    if (snapshot?.status === 'ready' && snapshot.value) return snapshot.value.onboardingSeen === true
    return this.memorySeen
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  attach(scope: SettingsScope<OnboardingSettings>): void {
    this.unsubscribe?.()
    this.scope = scope
    this.unsubscribe = scope.subscribe(() => {
      const snapshot = scope.getSnapshot()
      if (snapshot.status === 'ready' && snapshot.value && snapshot.value.onboardingSeen === this.optimisticSeen) this.optimisticSeen = undefined
      this.emit()
    })
    this.emit()
  }

  detach(scope: SettingsScope<OnboardingSettings>): void {
    if (this.scope !== scope) return
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.scope = undefined
    this.emit()
  }

  markSeen(): void { this.write(true) }
  replay(): void { this.write(false) }

  private write(next: boolean): void {
    this.memorySeen = next
    this.optimisticSeen = next
    this.emit()
    const snapshot = this.scope?.getSnapshot()
    if (!this.scope || snapshot?.status !== 'ready' || !snapshot.writable) return
    void this.scope.set('onboardingSeen', next).catch(() => {
      if (this.optimisticSeen === next) this.optimisticSeen = undefined
      this.emit()
    })
  }

  private emit(): void { this.listeners.forEach((listener) => listener()) }
}
