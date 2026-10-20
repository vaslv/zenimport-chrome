import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {runScenario,execute,normalized,dtoDigest,DomainError} from '../.local/contracts/runner.mjs';

const root=new URL('../contracts/business/v1/',import.meta.url);
const load=name=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
export async function runSuite() {
  const scenarios={},future=[];
  for(const name of readdirSync(new URL('scenarios/',root)).sort()) {
    const scenario=load('scenarios/'+name);
    if(scenario.implemented_by_stage!=='L2') {
      await assert.rejects(()=>runScenario(scenario),error=>error instanceof DomainError && ['unsupported_command','unsupported_scenario'].includes(error.code));
      future.push(scenario.id);continue;
    }
    const result=await runScenario(scenario);
    assert.deepEqual(result,scenario.expected,scenario.id);scenarios[scenario.id]=result;
  }
  const arithmetic=[];
  for(const row of load('arithmetic-vectors.json').vectors) {
    const value={};
    for(const operation of ['sum','subtract','compare','sign'])value[operation]=await execute('money.'+operation,
      {left:row.left,right:row.right,values:[row.left,row.right],value:row.left});
    assert.deepEqual(value,Object.fromEntries(Object.keys(value).map(key=>[key,row[key]])));
    arithmetic.push(value);
  }
  const unicode=[];
  for(const [value,expected] of load('unicode15.json').vectors) {
    const observed=normalized(value);assert.equal(observed,expected,JSON.stringify(value));unicode.push(observed);
  }
  return {scenarios,future_rejected:future,arithmetic_count:arithmetic.length,arithmetic_digest:await dtoDigest(arithmetic),
    unicode_count:unicode.length,unicode_digest:await dtoDigest(unicode),external_writes:0};
}
if(process.argv[1]===new URL(import.meta.url).pathname)process.stdout.write(JSON.stringify(await runSuite())+'\n');
