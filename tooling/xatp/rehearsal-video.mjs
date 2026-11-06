/** Encode a bounded six-second reproduction of the reference draft with the optional local FFmpeg renderer. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderDraft, createRehearsal, sample } from './rehearsal.mjs';

const renderer = {
  id:'ffmpeg-roc-rehearsal', mode:'demo', cost:'free', referenceImage:true,
  async submit({requestId,text,draftHash,bytes,parameters}) {
    if (!Buffer.from(renderDraft()).equals(bytes) || parameters.seconds !== 6) throw new Error('UNSUPPORTED_REHEARSAL_DRAFT');
    const directory = mkdtempSync(join(tmpdir(),'xatp-frames-'));
    try {
      for(let index=0;index<12;index++) {
        const step=Math.min(sample.length,index);
        writeFileSync(join(directory,'frame-'+String(index).padStart(2,'0')+'.svg'),renderDraft(sample,step));
      }
      const film = join(directory,'rehearsal.webm');
      const output = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-framerate','2','-c:v','librsvg','-i',join(directory,'frame-%02d.svg'),'-vf','fps=24,format=yuv420p','-threads','1','-c:v','libvpx-vp9','-b:v','0','-crf','26',film],{timeout:30000});
      if(output.status!==0) throw new Error(output.error?.message ?? output.stderr.toString('utf8'));
      return {requestId,text,draftHash,remoteId:'local-'+requestId.slice(0,8),model:null,mime:'video/webm',bytes:readFileSync(film)};
    } finally { rmSync(directory,{recursive:true,force:true}); }
  },
  async lookup() { return null; }
};

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Use: node rehearsal-video.mjs <new project directory>');
  const manifest=await createRehearsal(process.argv[2], renderer);
  console.log(JSON.stringify({mode:manifest.mode,shot:manifest.shot,records:manifest.records.length}));
}
