import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
export type OnboardingSettings = {
    onboardingSeen?: boolean;
};
/**
 * Keeps the first-use preference durable when DSH settings are available and
 * gracefully falls back to process memory when they are not. DSH Web may use
 * a different local port between launches, so browser storage is not a safe
 * persistence boundary for this preference.
 */
export declare class OnboardingPreference {
    private scope;
    private unsubscribe;
    private readonly listeners;
    private memorySeen;
    private optimisticSeen;
    get seen(): boolean;
    subscribe(listener: () => void): () => void;
    attach(scope: SettingsScope<OnboardingSettings>): void;
    detach(scope: SettingsScope<OnboardingSettings>): void;
    markSeen(): void;
    replay(): void;
    private write;
    private emit;
}
