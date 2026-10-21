"""Detached verified credentials never select a writer or change a remote Root."""
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_application import call as application


def candidate(worker,action,**args):return worker.evaluate('data=>migrationProbe.run(data.action,data.args)',dict(action=action,args=dict(url='https://unused.invalid',token='synthetic-detached-credential')|args))


def test_native_candidate_verification_survives_restart_without_changing_remote_mode(tmp_path):
    path,profile=tmp_path/'extension',tmp_path/'profile'
    with sync_playwright() as p:
        with installed(p,path,profile) as (_,worker,_,identifier):
            before=application(worker,'legacy');assert before['ok'] and before['root']['activeMode']=='remote'
            verified=candidate(worker,'candidate-verify');assert verified['ok'] and verified['result']['owners']==['1'],verified
            ref=verified['result']['ref'];after=application(worker,'status')
            assert after['root']==before['root'] and after['financialRows']==before['financialRows']
            assert 'token' not in verified['result']
        with installed(p,path,profile,known_id=identifier) as (_,worker,_,_):
            proof=candidate(worker,'candidate-read',ref=ref);assert proof['ok'] and proof['result']['ownerIds']==['1'],proof
            assert proof['result']['sourceHash']==verified['result']['hash']
            assert application(worker,'status')['root']==before['root']
            wrong=candidate(worker,'candidate-read',ref=ref,raw='{"serverTimestamp":101,"user":[{"id":2}],"account":[],"instrument":[],"tag":[],"transaction":[]}')
            assert wrong==dict(ok=False,code='zenmoney_wrong_owner')
            assert candidate(worker,'candidate-read',ref=ref)['ok']


def test_native_rejected_candidate_never_becomes_an_acknowledged_secret(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'extension',tmp_path/'profile') as (_,worker,_,_):
        before=application(worker,'legacy');assert before['ok']
        assert candidate(worker,'candidate-verify',owners=['2'])==dict(ok=False,code='zenmoney_wrong_owner')
        assert candidate(worker,'candidate-verify',permission=False)==dict(ok=False,code='zenmoney_permission')
        keys=worker.evaluate('async()=>Object.keys(await chrome.storage.local.get(null)).filter(key=>key.startsWith("localCredential:"))')
        assert keys==[] and application(worker,'status')['root']==before['root']
