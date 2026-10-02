/**
 * Structural contracts for the DSH host services this plugin consumes (the
 * /jumpserver slash command and the systemPrompt SOP section).
 *
 * The real services live in @deepseek-ai/dsh-commands and
 * @deepseek-ai/dsh-system-prompt (host-composition plugins). This file
 * restates ONLY the surface this plugin touches so the plugin typechecks and
 * runs without depending on those packages in its own node_modules; the
 * plugin accesses them through cast-only seams (see index.ts). Consumers
 * installing the real packages get the same behavior at runtime.
 */
export interface CommandInputDescriptor {
    /** Placeholder shown before the user supplies free-form input. */
    hint?: string;
    /** Whether composer image attachments may accompany an invocation. */
    images?: boolean;
}
export type CommandResult = {
    kind: 'success';
    text?: string;
    sourceEventSeq?: number;
} | {
    kind: 'error';
    text: string;
};
/** The live agent the dispatching UI routed the slash command to. */
export interface CommandAgentLike {
    readonly id: string;
    /** The durable session; its header.id is the same id the tools key on. */
    readonly session?: {
        header?: {
            id?: unknown;
        };
    };
    readonly status: 'idle' | 'running';
    /** Agent-scoped cordis context (used for the turn-settle relock listener). */
    readonly ctx: {
        on(event: string, listener: (payload: unknown) => void): () => void;
    };
    /** Queue an ordinary follow-up turn and wake the driver. */
    followup(message: {
        id: string;
        role: 'user';
        content: Array<{
            type: 'text';
            text: string;
        }>;
        source: Record<string, unknown>;
    }): void;
    /** Resolve after the current whole-agent activity reaches quiescence. */
    whenIdle(): Promise<void>;
}
export interface CommandInvocation {
    readonly commandId: unknown;
    readonly agent: CommandAgentLike;
    /** Exact text following the registered command name, including separator whitespace. */
    readonly rawInput: string;
    readonly signal: AbortSignal;
}
export interface CommandDefinition {
    /** Lowercase command name without the leading slash. */
    readonly name: string;
    readonly description: string;
    readonly input?: CommandInputDescriptor;
    readonly recordInput?: boolean;
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
export interface CommandService {
    register(definition: CommandDefinition): () => void;
}
/** Minimal systemPrompt surface (section() only, as used by the SOP). */
export interface SystemPromptService {
    section(section: {
        name: string;
        order: number;
        /** Static text or a provider evaluated per assembly. */
        text: string | ((context: unknown) => string);
        complete?: boolean;
    }): () => void;
}
export interface JumpServerHostServices {
    commands: CommandService;
    systemPrompt: SystemPromptService;
}
