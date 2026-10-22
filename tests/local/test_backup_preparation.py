"""Native pre-snapshot quiescence is durable and cancellable before any hold."""
from uuid import uuid4
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_control_api import control,call


def test_local_export_preparation_survives_full_restart_and_cancellation_fences_the_same_id(tmp_path):
    extension,profile=tmp_path/'ext',tmp_path/'profile';id=str(uuid4());cancelled=str(uuid4())
    with sync_playwright() as p:
        with installed(p,extension,profile) as (_,worker,_,identifier):
            control(worker,'storage-status');configured=control(worker,'local-configure',token='synthetic-verified-only')
            assert call(worker,'catalog')['ok'];generation=configured['root']['activeGeneration']
            started=call(worker,'control',token='quiescing-once',data=dict(type='archive-export-begin',id=cancelled,kind='local',generation=generation))
            assert started['ok'] and started['value']['result']['state']=='quiescing',started
            assert started['root']['pendingSwitchId'] is None
            state=control(worker,'archive-status')['value']['storage']['archives'];assert state['preparation']['id']==cancelled and state['backups']==[]
            competing=call(worker,'control',data=dict(type='archive-export-begin',id=str(uuid4()),kind='local',generation=generation))
            assert not competing['ok'] and competing['code']=='migration_busy',competing
            assert control(worker,'archive-export-cancel',id=cancelled,kind='local')['value']['result']['phase']=='cancelled'
            late=call(worker,'control',data=dict(type='archive-export-begin',id=cancelled,kind='local',generation=generation))
            assert not late['ok'] and late['code']=='stale_context',late
            started=call(worker,'control',token='quiescing-once',data=dict(type='archive-export-begin',id=id,kind='local',generation=generation))
            assert started['ok'] and started['value']['result']['state']=='quiescing',started
        with installed(p,extension,profile,known_id=identifier) as (_,worker,_,_):
            before=control(worker,'archive-status')['value']['storage']['archives'];assert before['preparation']['id']==id
            assert control(worker,'archive-export-step',id=id,kind='local')['value']['result']['state']=='building'
            assert control(worker,'archive-export-step',id=id,kind='local')['value']['result']['phase']=='ready'
            after=control(worker,'archive-status')['value']['storage']['archives'];assert after['preparation']['phase']=='complete'
            assert after['backups'][0]['id']==id and not after['backups'][0]['acknowledged']
