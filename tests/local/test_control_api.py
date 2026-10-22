"""Named trusted control dispatch using real native storage and synthetic SDK reads."""
from uuid import uuid4
from playwright.sync_api import sync_playwright
from test_runtime import installed


def call(worker,action,**args):
    return worker.evaluate('data=>applicationProbe.run(data.action,data.args)',dict(action=action,args=dict(name='control-api',mode='standalone',**args)))


def control(worker,type,**data):
    value=call(worker,'control',data=dict(type=type,**data));assert value['ok'],value
    return value


def test_fresh_control_status_token_setup_and_removal_keep_the_same_native_dataset(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        initial=control(worker,'storage-status');storage=initial['value']['storage']
        assert storage['mode']=='local' and not storage['local']['configured']
        assert storage['archives']['file'] is None and storage['archives']['sources']==[]
        original=initial['root']['activeGeneration']
        control(worker,'local-draft',token='synthetic-draft-only')
        assert control(worker,'local-draft')['value']['token']=='synthetic-draft-only'
        control(worker,'local-draft',token='')
        assert control(worker,'local-draft')['value']['token'] is None
        verified=control(worker,'local-configure',token='synthetic-verified-only')
        assert verified['root']['activeGeneration']==original and verified['root']['credentialRef']
        configured=control(worker,'storage-status')['value']['storage']
        assert configured['local']['configured'] and configured['local']['owners']==['1']
        assert 'synthetic-verified-only' not in str(configured) and 'credentialRef' not in str(configured)
        assert control(worker,'local-draft')['value']['token'] is None
        removed=control(worker,'local-remove');assert removed['root']['activeGeneration']==original
        assert removed['root']['credentialRef'] is None
        assert not control(worker,'storage-status')['value']['storage']['local']['configured']


def test_control_upload_resume_checks_canonical_chunks_and_does_not_select_a_writer(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        import base64,hashlib
        root=control(worker,'storage-status')['root'];id=str(uuid4());raw=b'synthetic-not-a-recovery-archive'
        file=control(worker,'archive-upload-begin',id=id,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())['value']['file']
        for encoded in ['a','!!!','eA==\n']:
            rejected=call(worker,'control',data=dict(type='archive-upload-chunk',id=id,nonce=file['nonce'],number=0,base64=encoded))
            assert not rejected['ok']
        control(worker,'archive-upload-chunk',id=id,nonce=file['nonce'],number=0,base64=base64.b64encode(raw).decode())
        assert control(worker,'archive-upload-seal',id=id)['value']['file']['phase']=='ready'
        current=control(worker,'archive-status');assert current['root']==root
        assert current['value']['storage']['archives']['file']['id']==id
        assert control(worker,'archive-upload-discard',id=id)['value']['result']==dict(complete=False)
        assert control(worker,'archive-upload-discard',id=id)['value']['result']==dict(complete=True)


def test_export_before_first_catalog_fails_before_hold_then_a_complete_mirror_can_be_exported(tmp_path):
    with sync_playwright() as p,installed(p,tmp_path/'ext',tmp_path/'profile') as (_,worker,_,_):
        control(worker,'storage-status');configured=control(worker,'local-configure',token='synthetic-verified-only')
        before=configured['root'];id=str(uuid4())
        result=call(worker,'control',data=dict(type='archive-export-begin',kind='local',id=id,generation=before['activeGeneration']))
        assert not result['ok'] and result['code']=='migration_incomplete'
        assert control(worker,'storage-status')['root']==before
        assert call(worker,'catalog')['ok']
        prepared=control(worker,'archive-export-begin',kind='local',id=id,generation=before['activeGeneration'])
        assert prepared['value']['result']['state']=='building' and prepared['root']['pendingSwitchId']==id
        ready=control(worker,'archive-export-step',kind='local',id=id)
        assert ready['value']['result']['phase']=='ready' and ready['root']['pendingSwitchId'] is None
