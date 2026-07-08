import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const mobileRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const fingerprintExecutable = NodePath.join(mobileRoot, "node_modules", ".bin", "fingerprint");

const result = NodeChildProcess.spawnSync(
  fingerprintExecutable,
  ["fingerprint:generate", "--ignore-path", "eas.json"],
  {
    cwd: mobileRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      APP_VARIANT: "preview",
      MOBILE_VERSION_POLICY: "fingerprint",
      // The generated value must describe native inputs, not the previous pin.
      T3CODE_MOBILE_RUNTIME_VERSION: "",
    },
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const fingerprint = JSON.parse(result.stdout);
if (typeof fingerprint.hash !== "string" || fingerprint.hash.length === 0) {
  throw new Error("Expo fingerprint generation did not return a hash.");
}

const easConfigPath = NodePath.join(mobileRoot, "eas.json");
const easConfig = JSON.parse(NodeFS.readFileSync(easConfigPath, "utf8"));
const previewEnvironment = easConfig?.build?.preview?.env;
if (!previewEnvironment) {
  throw new Error("eas.json does not define build.preview.env.");
}

const previousRuntimeVersion = previewEnvironment.T3CODE_MOBILE_RUNTIME_VERSION;
previewEnvironment.T3CODE_MOBILE_RUNTIME_VERSION = fingerprint.hash;
NodeFS.writeFileSync(easConfigPath, `${JSON.stringify(easConfig, null, 2)}\n`);

if (previousRuntimeVersion === fingerprint.hash) {
  console.log(`Preview runtime version is already ${fingerprint.hash}.`);
} else {
  console.log(`Updated preview runtime version to ${fingerprint.hash}.`);
}
