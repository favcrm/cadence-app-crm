import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, hash, files, inputs, sourceDigest, operationInventory } from "./screen_inputs.mjs";
const env = inputs(process.argv.slice(2));
const ts = env.require("typescript");
const options = { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler, jsx:ts.JsxEmit.ReactJSX, strict:true, skipLibCheck:true, isolatedModules:true, verbatimModuleSyntax:true, noUnusedLocals:true, noUnusedParameters:true, noEmit:true, typeRoots:[join(env.toolchain,"node_modules/@types")] };
const host=ts.createCompilerHost(options);
host.resolveModuleNames=(names,file)=>names.map(name => name === "@cadence/screen-ui" ? {resolvedFileName:join(env.kit,"types/screen-ui/src/index.d.ts"),extension:ts.Extension.Dts} : name === "@cadence/screen-ui/styles.css" ? undefined : ts.resolveModuleName(name,file,options,ts.sys).resolvedModule ?? (!name.startsWith('.') ? ts.resolveModuleName(name,join(env.toolchain,'src/__crm__.tsx'),options,ts.sys).resolvedModule : undefined));
const sources=files(join(root,'src')).filter(p=>/\.tsx?$/.test(p));
const program=ts.createProgram(sources,options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
console.log('CRM strict typecheck: passed');
if(process.argv.includes('--typecheck-only')) process.exit(0);
const {build}=await import(pathToFileURL(env.require.resolve('vite')));
const {default:react}=await import(pathToFileURL(env.require.resolve('@vitejs/plugin-react')));
// Derive the closed declaration from the same source table without runtime evaluation.
const operations=operationInventory();
const out=join(root,'app/screens/crm');mkdirSync(out,{recursive:true});
const globals = {'react':'CadenceCrmRuntime.React','react-dom':'CadenceCrmRuntime.ReactDOM','react-dom/client':'CadenceCrmRuntime.ReactDOMClient','react/jsx-runtime':'CadenceCrmRuntime.JSXRuntime'};
for (const runtime of [true,false]) {
await build({configFile:false,root,define:{'process.env.NODE_ENV':'"production"'},plugins:[react(),{
  name:'crm-pinned-inputs',
  resolveId(name){
    if(name==='@cadence/screen-ui')return join(env.kit,'index.js');
    if(name==='@cadence/screen-ui/styles.css')return join(env.kit,'styles.css');
    if(name==='@hugeicons/react'||name==='@hugeicons/core-free-icons') {
      const manifest=join(env.toolchain,'node_modules',name,'package.json');
      const pkg=JSON.parse(readFileSync(manifest,'utf8'));
      return join(manifest,'..',pkg.module);
    }
    if(/^(react(?:\/.*)?|react-dom(?:\/.*)?)$/.test(name)) {
      if (!runtime) {
        if (!Object.hasOwn(globals,name)) throw new Error(`Unlisted framework external: ${name}`);
        return {id:name,external:true};
      }
      return env.require.resolve(name);
    }
  },
  buildEnd(error){if(error)return;for(const id of this.getModuleIds())if(id.includes('/ui/src/'))throw new Error(`Host authority import escaped package: ${id}`);},
  generateBundle(_options,bundle){
    const chunks=Object.values(bundle).filter(item=>item.type==='chunk');
    if(chunks.length!==1 || chunks[0].dynamicImports.length || chunks[0].imports.some(id=>runtime || !Object.hasOwn(globals,id)))throw new Error('Screen requires two static IIFEs with only closed app-local externals');
    const chunk=chunks[0], ids=[...this.getModuleIds()];
    const framework=ids.filter(id=>/\/node_modules\/(react|react-dom|scheduler)\//.test(id));
    const reactRoot=framework.filter(id=>id.endsWith('/react/cjs/react.production.js'));
    if (runtime ? reactRoot.length!==1 : framework.length!==0) throw new Error('Framework partition must contain exactly one React implementation in runtime and none in client');
    // Rolldown's rendered chunk imports carry the static external IDs;
    // getModuleIds enumerates the internal graph, not this external closure.
    const external=[...chunk.imports];
    if (runtime ? external.length!==0 : JSON.stringify(external.sort())!==JSON.stringify(Object.keys(globals).sort())) throw new Error('Unexpected framework partition externals');
    for (const id of ids) {
      const info=this.getModuleInfo(id);
      if (runtime && info?.importedIds.includes('react')) throw new Error('Unresolved runtime React import');
    }
    console.log(JSON.stringify({partition:runtime?'runtime.js':'client.js',format:_options.format,external,frameworkModules:framework,renderedModules:Object.entries(chunk.modules).filter(([,m])=>m.renderedLength>0).map(([id,m])=>({id,bytes:m.renderedLength})),frameworkGraph:framework.map(id=>({id,imports:this.getModuleInfo(id)?.importedIds}))}));
  },
}],build:{outDir:out,emptyOutDir:runtime,minify:true,sourcemap:false,lib:{entry:join(root,runtime?'src/runtime.ts':'src/main.tsx'),name:runtime?'CadenceCrmRuntime':'CadenceCrm',formats:['iife'],fileName:()=>runtime?'runtime.js':'client.js',cssFileName:'crm'},rolldownOptions:{external:runtime?[]:Object.keys(globals),output:{codeSplitting:false,globals:id=>{if(!Object.hasOwn(globals,id))throw new Error(`Unlisted IIFE global: ${id}`);return globals[id];}}}}});
}
const assets=['runtime.js','client.js','crm.css'].map(path=>{const body=readFileSync(join(out,path));const cap=path.endsWith('.js')?393216:131072;if(body.length>cap)throw new Error(`${path}: ${body.length} exceeds ${cap}`);return {name:path,media_type:path.endsWith('.js')?'text/javascript':'text/css',size:body.length,sha256:`sha256:${hash(body)}`};});
if(assets.reduce((n,a)=>n+a.size,0)>524288)throw new Error('Screen total exceeds 524288 bytes');
const decl={contract:'app-screens/v2',app:'crm',entry:'client.js',startup:['runtime.js','client.js'],assets,provenance:{source_digest:`sha256:${sourceDigest()}`,sdk_digest:`sha256:${env.pin.archive.sha256}`,toolchain_digest:`sha256:${hash(JSON.stringify(env.pin.toolchain))}`},host_contract:'screen-records.v1',may:['records.call','records.slot'],tools:{},operations,navigation:{section_query:'crm',default_section:'customers',sections:[{id:'customers',label:'Customers'},{id:'segments',label:'Segments'},{id:'campaigns',label:'Campaigns'}]}};
const declaration=JSON.stringify(decl,null,2)+'\n';
if(Buffer.byteLength(declaration)>16384)throw new Error('Screen declaration exceeds 16384 bytes');
writeFileSync(join(out,'screens.json'),declaration);
console.log(JSON.stringify({development:env.dev,sdk:env.pin.archive,assets,total:assets.reduce((n,a)=>n+a.size,0)},null,2));
