const {app,dialog}=require('electron');
try{require('./main')}catch(error){
  app.whenReady().then(()=>{
    dialog.showErrorBox('Codex Auth Manager 启动失败','启动组件未能加载。请重新安装完整安装包；不要单独复制 EXE。错误代码：'+(typeof error.code==='string'?error.code:'BOOTSTRAP_FAILED'));
    app.exit(1);
  });
}
