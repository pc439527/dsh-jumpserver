export function jumpHostServices(ctx) {
    const read = (name) => typeof ctx.get === 'function'
        ? ctx.get(name)
        : undefined;
    return {
        commands: read('commands'),
        systemPrompt: read('systemPrompt'),
    };
}
