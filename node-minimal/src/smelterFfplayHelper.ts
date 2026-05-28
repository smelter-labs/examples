import { spawn } from 'node:child_process';

/**
 * Starts an RTMP server on the given port and displays the incoming stream with
 * ffplay. This is a development helper only — remove it for any real production
 * use, where Smelter should push directly to your RTMP destination.
 */
export async function ffplayStartPlayerAsync(port: number): Promise<void> {
  const command = 'bash';
  const args = [
    '-c',
    `ffmpeg -f flv -listen 1 -i rtmp://0.0.0.0:${port} -vcodec copy -f flv - | ffplay -f flv -i -`,
  ];
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('exit', (code: number | null) => {
    if (code !== 0) {
      console.error(`Command "${command} ${args.join(' ')}" failed with exit code ${code}.`);
    }
  });
  // Give ffmpeg a moment to start listening before Smelter connects.
  await new Promise<void>((res) => setTimeout(res, 2000));
}
