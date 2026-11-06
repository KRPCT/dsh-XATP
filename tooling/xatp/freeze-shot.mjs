/** Export a portable shot directory, with a manifest written only after all verified objects. */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportShot, readBlob } from './workspace.mjs';

export function freezeShot(directory, ref, destination) {
  const manifest = exportShot(directory,ref);
  const digests = new Set();
  for (const {data} of manifest.records) {
    for(const field of ['blob','rendererHash','samplesHash','draftHash','outputHash']) {
      if(data[field]) digests.add(data[field]);
    }
  }
  mkdirSync(destination,{mode:0o700});
  try {
    mkdirSync(join(destination,'objects'),{mode:0o700});
    for (const digest of digests) writeFileSync(join(destination,'objects',digest), readBlob(directory,digest), {flag:'wx',mode:0o600});
    writeFileSync(join(destination,'manifest.json'),JSON.stringify({...manifest,objects:[...digests].sort()},null,2)+'\n',{flag:'wx',mode:0o600});
    return {mode:manifest.mode,records:manifest.records.length,objects:digests.size};
  } catch(error) {
    rmSync(destination,{recursive:true,force:true});
    throw error;
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [project,id,version,destination] = process.argv.slice(2);
  if (!destination) throw new Error('Use: node freeze-shot.mjs <project> <shot id> <version> <new folder>');
  console.log(JSON.stringify(freezeShot(project,{id,version:Number(version)},destination)));
}
