import { spawn } from 'node:child_process';

const STEPS = [
  { key: 'lint', command: ['run', 'lint'] },
  { key: 'test:run', command: ['run', 'test:run'] },
  { key: 'build', command: ['run', 'build'] },
];

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runStep(step) {
  return new Promise((resolve) => {
    const npmExecPath = process.env.npm_execpath;
    const npmCommand = npmExecPath ? process.execPath : getNpmCommand();
    const commandArgs = npmExecPath ? [npmExecPath, ...step.command] : step.command;

    const child = spawn(npmCommand, commandArgs, {
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });

    child.on('error', () => {
      resolve(1);
    });
  });
}

async function main() {
  const results = STEPS.map((step) => ({
    step: step.key,
    status: 'SKIPPED',
    exitCode: null,
  }));

  let overallExitCode = 0;

  for (let index = 0; index < STEPS.length; index += 1) {
    const step = STEPS[index];
    const exitCode = await runStep(step);

    results[index].exitCode = exitCode;
    results[index].status = exitCode === 0 ? 'PASS' : 'FAIL';

    console.log(`EXIT ${step.key}=${exitCode}`);

    if (exitCode !== 0) {
      overallExitCode = exitCode;
      break;
    }
  }

  console.log('');
  console.log('Commit Gate Summary');
  console.log('-------------------');
  for (const result of results) {
    const exit = result.exitCode === null ? '-' : String(result.exitCode);
    console.log(`${result.step.padEnd(8)} ${result.status.padEnd(7)} EXIT=${exit}`);
  }

  process.exit(overallExitCode);
}

main();
