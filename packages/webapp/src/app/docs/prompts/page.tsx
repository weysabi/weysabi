import Link from "next/link";

export default function PromptsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground mb-8 block">
        &larr; Back to docs
      </Link>
      <h1 className="text-3xl font-bold mb-6">Prompts</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Overview</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Weysabi&apos;s prompt management system lets you define typed, versioned prompt templates
          and execute them through the full provider pipeline in one call.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Defining a Prompt</h2>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto mb-4">
          <code>{`sabi.prompts.register({
  id: "classify",
  messages: [
    {
      role: "system",
      content: "You are a support ticket classifier.",
    },
    {
      role: "user",
      content: "Classify the following ticket:\\n\\n{ticket_text}",
    },
  ],
  model: "groq/llama-4-scout",
  temperature: 0.3,
  maxTokens: 50,
  schema: z.object({
    category: z.enum(["billing", "technical", "account", "feature_request"]),
  }),
});`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Running a Prompt</h2>
        <p className="mb-3 text-sm text-muted-foreground">Render and execute in one call:</p>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto mb-4">
          <code>{`const result = await sabi.prompts.run("classify", {
  ticket_text: "I was charged twice for my subscription",
});

console.log(result.parsed?.category); // "billing"
console.log(result.content); // raw response text`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Variable Substitution</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Templates use <code className="text-xs">{`{variable}`}</code> syntax. Pass values at
          render time:
        </p>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto mb-4">
          <code>{`const messages = sabi.prompts.render("classify", {
  ticket_text: "Can you reset my password?",
});
// [{ role: "system", content: "..." }, { role: "user", content: "Classify...Can you reset..." }]`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Runtime Overrides</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Override model, temperature, schema, or any field at runtime:
        </p>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto mb-4">
          <code>{`const result = await sabi.prompts.run("classify", { ticket_text: "..." }, {
  model: "openai/gpt-4o",
  temperature: 0.5,
  maxTokens: 100,
});`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Managing Prompts</h2>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto">
          <code>{`// Register multiple at once
sabi.prompts.registerMany([
  { id: "summarize", messages: [...], model: "groq/llama-4-scout" },
  { id: "translate", messages: [...], model: "openai/gpt-4o-mini" },
]);

// List all
console.log(sabi.prompts.list());

// Check existence
if (sabi.prompts.has("classify")) { /* ... */ }

// Get definition
const prompt = sabi.prompts.get("classify");
console.log(prompt?.definition);

// Remove
sabi.prompts.remove("classify");

// Clear all
sabi.prompts.clear();`}</code>
        </pre>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Initial Definitions</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Pass prompt definitions at construction time:
        </p>
        <pre className="rounded bg-muted p-4 text-sm overflow-x-auto">
          <code>{`const sabi = createWeysabi({
  groq: { apiKey: "..." },
}, {
  promptDefinitions: [
    { id: "classify", messages: [...], model: "groq/llama-4-scout" },
  ],
});`}</code>
        </pre>
      </section>
    </article>
  );
}
