use anyhow::{anyhow, Context, Result};
use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

#[derive(Debug, Parser)]
#[command(name = "wf", version, about = "Harness native runtime")]
struct Cli {
    #[command(subcommand)]
    command: CommandKind,
}

#[derive(Debug, Subcommand)]
enum CommandKind {
    Search(SearchArgs),
    Extension {
        #[command(subcommand)]
        command: ExtensionCommand,
    },
    Ui {
        #[command(subcommand)]
        command: UiCommand,
    },
    Runtime {
        #[command(subcommand)]
        command: RuntimeCommand,
    },
}

#[derive(Debug, Args)]
struct SearchArgs {
    #[arg(long)]
    question: Option<String>,
    #[arg(long, default_value = "auto")]
    mode: String,
    #[arg(long)]
    project: Option<PathBuf>,
}

#[derive(Debug, Subcommand)]
enum ExtensionCommand {
    List(CommonArgs),
    Status(ExtensionIdArgs),
    Install(InstallArgs),
    Download(InstallArgs),
    Remove(InstallArgs),
    Doctor(CommonArgs),
}

#[derive(Debug, Args)]
struct CommonArgs {
    #[arg(long)]
    project: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct ExtensionIdArgs {
    id: String,
    #[arg(long)]
    project: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct InstallArgs {
    id: String,
    #[arg(long)]
    project: Option<PathBuf>,
    #[arg(long)]
    apply: bool,
}

#[derive(Debug, Subcommand)]
enum UiCommand {
    Start(CommonArgs),
    Status(CommonArgs),
    Inspect(CommonArgs),
}

#[derive(Debug, Subcommand)]
enum RuntimeCommand {
    Pack(CommonArgs),
    Show(CommonArgs),
    State(CommonArgs),
}

fn project_root(explicit: Option<PathBuf>) -> Result<PathBuf> {
    let root = explicit.unwrap_or(std::env::current_dir()?);
    Ok(root.canonicalize().unwrap_or(root))
}

fn registry_path(project: &Path) -> PathBuf {
    if let Ok(value) = std::env::var("WF_EXTENSION_REGISTRY") {
        return PathBuf::from(value);
    }
    project.join("Harness").join("extensions").join("registry.json")
}

fn read_registry(project: &Path) -> Result<Value> {
    let path = registry_path(project);
    let content = fs::read_to_string(&path)
        .with_context(|| format!("cannot read extension registry {}", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("invalid extension registry {}", path.display()))
}

fn extensions(registry: &Value) -> Result<&Vec<Value>> {
    registry
        .get("extensions")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("extension registry must contain an extensions array"))
}

fn find_extension<'a>(registry: &'a Value, id: &str) -> Result<&'a Value> {
    extensions(registry)?
        .iter()
        .find(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| anyhow!("extension is not registered: {id}"))
}

fn print_json(value: Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}

fn package_name(extension: &Value) -> Result<String> {
    extension
        .get("package")
        .and_then(|package| package.get("name"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow!("extension does not declare a pnpm package"))
}

fn resolve_wf_ui_bin(project: &Path) -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("WF_UI_BIN") {
        if !custom.is_empty() {
            return Some(PathBuf::from(custom));
        }
    }
    let base = project.join("node_modules").join(".bin").join("wf-ui");
    let with_ext = base.with_extension("cmd");
    if with_ext.exists() {
        return Some(with_ext);
    }
    if base.exists() {
        return Some(base);
    }
    let shim = project.join("node_modules").join("@zingspark").join("wf-extension-ui").join("bin").join("wf-ui.js");
    if shim.exists() {
        return Some(shim);
    }
    None
}

fn run_wf_ui(project: &Path, command: &str) -> Result<Value> {
    let bin = match resolve_wf_ui_bin(project) {
        Some(path) => path,
        None => {
            return Ok(json!({
                "ok": false,
                "status": "extension-required",
                "extension": "wf-ui",
                "project": project,
                "install": "pnpm exec wf extension install wf-ui --apply",
                "hint": "install @zingspark/wf-extension-ui then re-run"
            }));
        }
    };

    let mut cmd = Command::new("pnpm");
    cmd.arg("exec");
    cmd.arg("wf-ui");
    cmd.arg(command);
    cmd.arg("--project");
    cmd.arg(project);
    cmd.current_dir(project);
    cmd.env_remove("NO_COLOR");

    let output = cmd
        .output()
        .with_context(|| format!("failed to launch pnpm exec wf-ui {} from {}", command, bin.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Try to parse the stdout as JSON; otherwise surface raw text.
    let parsed: Result<Value, _> = serde_json::from_str(stdout.trim());
    let body = parsed.unwrap_or(json!({ "raw": stdout }));

    // Propagate ok/status from parsed body when present, falling back to exit code.
    let exit_ok = output.status.success();
    let ok = body.get("ok").and_then(Value::as_bool).unwrap_or(exit_ok);
    let status = match body.get("status").and_then(Value::as_str) {
        Some(s) => Value::String(s.to_owned()),
        None => json!(if exit_ok { "ok" } else { "failed" }),
    };

    Ok(json!({
        "ok": ok,
        "status": status,
        "command": format!("ui {}", command),
        "extension": "wf-ui",
        "project": project,
        "binary": bin,
        "exitCode": output.status.code().unwrap_or(-1),
        "result": body,
        "stderr": if stderr.trim().is_empty() { Value::Null } else { Value::String(stderr.to_string()) }
    }))
}

fn package_version(extension: &Value) -> Result<String> {
    extension
        .get("package")
        .and_then(|package| package.get("version"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow!("extension does not declare a package version"))
}

fn install_package(project: &Path, extension: &Value, apply: bool) -> Result<Value> {
    let name = package_name(extension)?;
    let version = package_version(extension)?;
    let spec = format!("{name}@{version}");
    if !apply {
        return Ok(json!({
            "ok": true,
            "status": "planned",
            "manager": "pnpm",
            "package": spec,
            "command": ["pnpm", "add", "--save-dev", spec]
        }));
    }

    let status = Command::new("pnpm")
        .args(["add", "--save-dev", &spec])
        .current_dir(project)
        .status()
        .with_context(|| "failed to start pnpm; install pnpm before applying an extension")?;
    if !status.success() {
        return Err(anyhow!("pnpm failed while installing {spec}"));
    }
    Ok(json!({
        "ok": true,
        "status": "installed",
        "manager": "pnpm",
        "package": spec,
        "project": project
    }))
}

fn run(cli: Cli) -> Result<Value> {
    match cli.command {
        CommandKind::Search(args) => {
            let project = project_root(args.project)?;
            let question = args.question.unwrap_or_default();
            let mut required = Vec::new();
            let lowered = question.to_lowercase();
            if lowered.contains("video") || lowered.contains("视频") || lowered.contains("youtube") || lowered.contains("bilibili") {
                required.push("wf-search-media");
            }
            if lowered.contains("transcript") || lowered.contains("asr") || lowered.contains("字幕") || lowered.contains("转录") {
                required.push("wf-search-asr");
            }
            if lowered.contains("vlm") || lowered.contains("frame") || lowered.contains("画面") || lowered.contains("视觉") {
                required.push("wf-search-vlm");
            }
            Ok(json!({
                "ok": true,
                "command": "search",
                "mode": args.mode,
                "question": question,
                "project": project,
                "requiredExtensions": required,
                "next": "Agent controller executes the returned search plan and only loads selected extension capabilities."
            }))
        }
        CommandKind::Extension { command } => {
            let project = match &command {
                ExtensionCommand::List(args) | ExtensionCommand::Doctor(args) => project_root(args.project.clone())?,
                ExtensionCommand::Status(args) => project_root(args.project.clone())?,
                ExtensionCommand::Install(args) | ExtensionCommand::Download(args) | ExtensionCommand::Remove(args) => project_root(args.project.clone())?,
            };
            let registry = read_registry(&project)?;
            match command {
                ExtensionCommand::List(_) => Ok(json!({ "ok": true, "extensions": extensions(&registry)? })),
                ExtensionCommand::Status(args) => {
                    let extension = find_extension(&registry, &args.id)?;
                    Ok(json!({
                        "ok": true,
                        "id": args.id,
                        "kind": extension.get("kind"),
                        "defaultInstall": extension.get("defaultInstall").unwrap_or(&Value::Bool(false)),
                        "package": extension.get("package"),
                        "project": project
                    }))
                }
                ExtensionCommand::Install(args) | ExtensionCommand::Download(args) => {
                    let extension = find_extension(&registry, &args.id)?;
                    install_package(&project, extension, args.apply)
                }
                ExtensionCommand::Remove(args) => {
                    let extension = find_extension(&registry, &args.id)?;
                    let name = package_name(extension)?;
                    if !args.apply {
                        return Ok(json!({
                            "ok": true,
                            "status": "planned",
                            "manager": "pnpm",
                            "package": name,
                            "command": ["pnpm", "remove", "--save-dev", name]
                        }));
                    }
                    let status = Command::new("pnpm")
                        .args(["remove", "--save-dev", &name])
                        .current_dir(&project)
                        .status()
                        .with_context(|| "failed to start pnpm")?;
                    if !status.success() {
                        return Err(anyhow!("pnpm failed while removing {name}"));
                    }
                    Ok(json!({ "ok": true, "status": "removed", "package": name, "project": project }))
                }
                ExtensionCommand::Doctor(_) => Ok(json!({
                    "ok": true,
                    "status": "ready-to-check",
                    "project": project,
                    "note": "Package health checks are extension-owned and must not load into the base Agent context."
                })),
            }
        }
        CommandKind::Ui { command } => {
            let (project, sub) = match &command {
                UiCommand::Start(args) => (project_root(args.project.clone())?, "start"),
                UiCommand::Status(args) => (project_root(args.project.clone())?, "status"),
                UiCommand::Inspect(args) => (project_root(args.project.clone())?, "inspect"),
            };
            run_wf_ui(&project, sub)
        }
        CommandKind::Runtime { command } => {
            let project = match &command {
                RuntimeCommand::Pack(args) | RuntimeCommand::Show(args) | RuntimeCommand::State(args) => project_root(args.project.clone())?,
            };
            Ok(json!({ "ok": true, "command": "runtime", "project": project, "status": "native-runtime-ready" }))
        }
    }
}

fn main() -> ExitCode {
    match run(Cli::parse()).and_then(print_json) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("wf: {error:#}");
            ExitCode::from(1)
        }
    }
}

