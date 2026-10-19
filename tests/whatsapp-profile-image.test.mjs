import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A foto de perfil do WhatsApp é fixa (public/whatsapp-profile.png): PNG quadrado, até 5 MB.
test('the fixed WhatsApp profile picture is a square PNG under 5 MB', () => {
 const png=readFileSync(new URL('../public/whatsapp-profile.png',import.meta.url));
 assert.equal(png.subarray(1,4).toString(),'PNG');
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 assert.equal(width,height);
 assert.ok(width>=640,'a Meta pede pelo menos 192 px; 640 ou mais fica nítido');
 assert.ok(png.length<5*1024*1024);
});

test('the profile action uses the fixed picture, not the site logo from Definições → Marca', () => {
 const src=readFileSync(new URL('../src/lib/actions/whatsapp.ts',import.meta.url),'utf8');
 assert.match(src,/whatsapp-profile\.png/);
 assert.doesNotMatch(src,/select\("logo_url"\)/);
});
