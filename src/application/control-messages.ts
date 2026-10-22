/** Only these explicit trusted commands may adopt their own native Root change. */
export const controlCommands=new Set([
  'storage-status','storage-candidate','storage-server','storage-browser','storage-step','storage-retry','storage-cancel',
  'local-draft','local-configure','local-remove',
  'archive-status','archive-upload-begin','archive-upload-status','archive-upload-chunk','archive-upload-seal','archive-upload-discard',
  'archive-export-begin','archive-export-step','archive-export-retry','archive-export-chunk','archive-export-ack','archive-export-cancel','archive-export-clean',
  'archive-import-begin','archive-import-step','archive-import-accept','archive-import-cancel','archive-import-retry','archive-import-clean',
]);
export const adoptsControlContext=new Set([
  'configure','local-configure','local-remove','storage-server','storage-browser','storage-step','storage-retry','storage-cancel',
  'archive-export-begin','archive-export-step','archive-export-retry','archive-export-cancel','archive-import-begin','archive-import-step',
  'archive-import-accept','archive-import-cancel','archive-import-retry',
]);
export const controlFields:Record<string,readonly string[]>={
 'storage-status':[],'archive-status':[],
 'local-draft':['token'],'local-configure':['token'],'local-remove':[],
 'storage-candidate':['url','token'],'storage-server':['id','ref','migrate','acceptMissingDedupEvidence'],
 'storage-browser':['token','pauseSharedServer','replaceInactiveLocalCopy'],
 'storage-step':['id'],'storage-retry':['id'],'storage-cancel':['id','requestId'],
 'archive-upload-begin':['id','bytes','sha256'],'archive-upload-status':['id'],
 'archive-upload-chunk':['id','nonce','number','base64'],'archive-upload-seal':['id'],'archive-upload-discard':['id'],
 'archive-export-begin':['id','kind','generation'],'archive-export-step':['id','kind'],'archive-export-retry':['id','kind'],'archive-export-chunk':['id','kind','number'],
 'archive-export-ack':['id','kind','sha256'],'archive-export-cancel':['id','kind'],'archive-export-clean':['id','kind'],
 'archive-import-begin':['id','target','token','formerWritersRetired','acceptPostSnapshotEvidenceLoss','replaceInactiveLocalCopy'],
 'archive-import-step':['id','target'],'archive-import-accept':['id','target','previewId'],'archive-import-cancel':['id','target'],
 'archive-import-retry':['id','target','refreshPreview'],'archive-import-clean':['id','target'],
};
