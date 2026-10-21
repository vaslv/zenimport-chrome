"""Persisted native participant <-> real SQLite participant, offline fixture ports."""
import base64
from hashlib import sha256
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from playwright.sync_api import sync_playwright
from test_runtime import installed
from test_authority import FIXTURE,ok,call

ROOT=Path('/interop')


def save(name,value):(ROOT/(name+'.json')).write_text(json.dumps(value))
def load(name):return json.loads((ROOT/(name+'.json')).read_text())


@pytest.mark.skipif(not ROOT.is_dir(),reason='requires the explicit offline authority-interop runner')
def test_real_native_and_sqlite_authority_both_directions_survive_browser_restart():
    phase=os.environ['AUTHORITY_PHASE'];known=load('native')['extension'] if phase!='initialize' else None
    with sync_playwright() as p,installed(p,ROOT/'extension',ROOT/'profile',known_id=known) as (_,worker,_,identifier):
        if phase=='initialize':
            peer=load('python');incoming=str(uuid4());outgoing=str(uuid4())
            ok(worker,'create','incoming')
            reserved=ok(worker,'reserve','incoming',switchId=incoming,peerId=peer['source'],credentialRef=str(uuid4()))
            current=ok(worker,'create','outgoing');source=current['participantId'];ok(worker,'seed','outgoing',fixture=FIXTURE)
            request=dict(request_id=str(uuid4()),switch_id=outgoing,expected_epoch='1',peer_id=peer['target'])
            ok(worker,'command','outgoing',participantId=source,command='source_start',request=request)
            sealed=ok(worker,'snapshot','outgoing',participantId=source,switchId=outgoing)
            raw=b''.join(base64.b64decode(ok(worker,'download','outgoing',participantId=source,switchId=outgoing,number=number))
                for number in range((int(sealed['archive_size'])+262143)//262144))
            assert sha256(raw).hexdigest()==sealed['archive_sha256'];(ROOT/'native.zip').write_bytes(raw)
            save('native',dict(extension=identifier,incoming=incoming,outgoing=outgoing,target=reserved['participantId'],generation=reserved['generation'],source=source))
            save('native-seal',sealed);save('native-outgoing-status',ok(worker,'status','outgoing',participantId=source,switchId=outgoing))
            save('native-outgoing-rows',ok(worker,'inspect','outgoing')['rows']);return
        native=load('native');ok(worker,'open','incoming');ok(worker,'open','outgoing')
        if phase=='exchange':
            seal=load('python-seal');switch=native['incoming'];target=native['target']
            ok(worker,'peer-fixture',switchId=switch,peerStatus=load('python-source-status'))
            def command(name,id,switch,command,**fields):
                epoch=ok(worker,'status',name,participantId=id,switchId=switch)['participant_epoch']
                request=dict(request_id=str(uuid4()),switch_id=switch,expected_epoch=epoch,**fields)
                return ok(worker,'command',name,participantId=id,command=command,request=request)
            command('incoming',target,switch,'destination_start',peer_receipt=seal)
            raw=(ROOT/'python.zip').read_bytes()
            for number,start in enumerate(range(0,len(raw),262144)):
                part=raw[start:start+262144];ok(worker,'chunk','incoming',participantId=target,switchId=switch,epoch='2',number=number,
                    base64=base64.b64encode(part).decode(),checksum=sha256(part).hexdigest())
            save('native-arm',command('incoming',target,switch,'destination_arm'))
            save('native-incoming-status',ok(worker,'status','incoming',participantId=target,switchId=switch))
            switch=native['outgoing'];ok(worker,'peer-fixture',switchId=switch,peerStatus=load('python-target-status'))
            save('native-handoff',command('outgoing',native['source'],switch,'source_handoff',peer_receipt=load('python-arm')))
            save('native-outgoing-status',ok(worker,'status','outgoing',participantId=native['source'],switchId=switch));return
        assert phase=='activate'
        switch=native['incoming'];target=native['target'];ok(worker,'peer-fixture',switchId=switch,peerStatus=load('python-source-status'))
        request=dict(request_id=str(uuid4()),switch_id=switch,expected_epoch='3',peer_receipt=load('python-handoff'))
        receipt=ok(worker,'command','incoming',participantId=target,command='destination_activate',request=request)
        assert receipt==ok(worker,'command','incoming',participantId=target,command='destination_activate',request=request)
        assert ok(worker,'reads','incoming')==1
        assert ok(worker,'status','incoming',participantId=target,switchId=switch)['awaiting_sync']
        assert not call(worker,'write','incoming')['ok']
        save('native-incoming-rows',ok(worker,'inspect','incoming')['rows'])
        ok(worker,'select-remote','outgoing',participantId=native['source'],switchId=native['outgoing'],credentialRef=str(uuid4()))
        assert ok(worker,'open','outgoing')['root']['activeMode']=='remote'
        assert not call(worker,'write','outgoing')['ok']
