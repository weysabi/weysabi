#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "./commands/init";
import { configValidateCommand } from "./commands/config";
import { completeCommand } from "./commands/complete";
import { streamCommand } from "./commands/stream";
import { promptListCommand, promptAddCommand, promptRemoveCommand } from "./commands/prompt";
import { benchmarkCommand } from "./commands/benchmark";
import { doctorCommand } from "./commands/doctor";
import { serverCommand } from "./commands/server";

const version = "0.5.0";

const program = new Command();

program
  .name("sabi")
  .description("AI orchestration CLI — completions, streaming, provider management")
  .version(version);

program
  .command("init")
  .description("Interactive project scaffolding (providers, prompts, defaults)")
  .action(initCommand);

program
  .command("config")
  .description("Manage configuration")
  .argument("<subcommand>", "validate")
  .action(async (subcommand: string) => {
    if (subcommand === "validate") {
      await configValidateCommand();
    } else {
      console.error(`Unknown subcommand: ${subcommand}. Use "validate".`);
      process.exit(1);
    }
  });

program
  .command("complete")
  .description("One-shot completion to stdout")
  .argument("<message>", "The message to send")
  .option("-m, --model <model>", "Model to use (e.g. groq/llama-4-scout)")
  .option("--no-config", "Skip sabi.json, use env vars only")
  .action(completeCommand);

program
  .command("stream")
  .description("Stream a completion to terminal")
  .argument("<message>", "The message to send")
  .option("-m, --model <model>", "Model to use (e.g. groq/llama-4-scout)")
  .option("--no-config", "Skip sabi.json, use env vars only")
  .action(streamCommand);

const prompt = program.command("prompt").description("Manage prompt templates");

prompt.command("list").description("List all prompts").action(promptListCommand);

prompt
  .command("add")
  .description("Add a prompt template")
  .argument("<name>", "Prompt name")
  .argument("[content]", "Prompt template content (omit for interactive input)")
  .action(promptAddCommand);

prompt
  .command("rm")
  .description("Remove a prompt template")
  .argument("<name>", "Prompt name")
  .action(promptRemoveCommand);

program
  .command("benchmark")
  .description("Benchmark provider latency")
  .option("-m, --model <model>", "Model to benchmark with")
  .option("--no-config", "Skip sabi.json, use env vars only")
  .action(benchmarkCommand);

program
  .command("doctor")
  .description("System diagnostics — runtime, version, API keys, config")
  .action(doctorCommand);

program
  .command("server")
  .description("Start an OpenAI-compatible HTTP server")
  .option("-p, --port <port>", "Port to listen on")
  .option("--host <host>", "Host to bind to")
  .action(serverCommand);

program.parse(process.argv);
