/* >_ cloud-bridge · 给单文件小账本接一根云端网线 🔌
 * 由嵌入脚本放进页面作用域，复用现有 state、弹窗与保存提示。
 * CLOUD_CONFIG 只放公开连接配置；OAuth Client Secret 留在 Supabase 控制台。
 */
const CLOUD_CONFIG = Object.freeze({
  url: "https://gihfseniokebvxxyqllq.supabase.co",
  publishableKey: "sb_publishable_PtcbnUriil2pr85iiQLoaw_LsTlJfkI",
  siteUrl: "https://jaqenhu.github.io/shopping-budget/"
});
const cloudConfigured = Boolean(CLOUD_CONFIG.url && CLOUD_CONFIG.publishableKey);
const localSnapshotAtStartup = JSON.parse(JSON.stringify(state));
const emptyCloudState = () => ({version:1,budget:0,items:[]});

function cloudGate(disabled) {
  $("budgetPanel").inert = disabled;
  document.querySelector(".layout").inert = disabled;
  $("addItem").disabled = disabled;
}
function updateCloudStatus(status) {
  if (!cloudUser || !syncEngine?.userId) {
    cloudGate(false);
    $("cloudNotice").hidden = true;
    return;
  }
  const labels = {
    loading:"读取云端记录…",saving:"正在同步…",synced:"已同步至云端",empty:"云端清单为空",
    pending:"待同步", "pending-error":"同步失败 · 待重试", "pending-uncached":"尚未保存",
    "read-error":"云端读取失败",conflict:"发现不同设备的修改"
  };
  $("saveStatus").textContent = labels[status.kind] || "云同步";
  cloudGate(!status.ready || status.loading || status.conflict);
  const messages = {
    loading:"正在读取这个账号的清单。",
    empty:"此账号还没有云端记录。可添加商品，或导入原来的 JSON 备份。",
    pending:"修改已留在本机，正在等待云端确认。",
    saving:"正在保存到云端。",
    "pending-error":"云端暂时无法连接。修改已留在本机，联网后点击重试。",
    "pending-uncached":"变更尚未写入云端，本机存储也未成功。请立即导出备份，避免关闭后丢失。",
    "read-error":status.ready?"云端读取失败，当前显示该账号在本机的缓存。可重试；新修改会暂存等待同步。":"云端读取失败，未加载默认清单，也不会覆盖云端数据。请重试或重新登录。",
    conflict:"其他设备已更新了清单。你的本地修改已保留，请选择使用哪一份。"
  };
  $("cloudNotice").hidden = status.kind === "synced";
  $("cloudMessage").textContent = messages[status.kind] || "";
  $("cloudRetry").hidden = !["pending-error","pending-uncached","read-error","conflict"].includes(status.kind);
  $("cloudRetry").disabled = status.loading;
  $("cloudExport").hidden = !["pending","pending-error","pending-uncached","conflict"].includes(status.kind);
  $("useRemote").hidden = status.kind !== "conflict";
  $("keepLocal").hidden = status.kind !== "conflict";
  const conflictReady = syncEngine.conflict && syncEngine.conflict.remote !== undefined;
  $("useRemote").disabled = !conflictReady;
  $("keepLocal").disabled = !conflictReady;
  $("migrateLocal").hidden = status.kind !== "empty" || !localSnapshotAtStartup.items.some(p=>!p.demo);
}
function cloudToast(message, localSaved) {
  if (syncEngine?.userId) {
    toast(localSaved ? message + " · 等待云端同步" : "变更尚未可靠保存，请导出备份");
  } else {
    toast(localSaved ? message : "变更尚未保存，请导出备份");
  }
}
async function applyCloudSession(session) {
  const nextUser = session?.user || null;
  if (nextUser?.id === cloudUser?.id) return;
  cloudUser = nextUser;
  $("loginCloud").hidden = Boolean(nextUser);
  $("logoutCloud").hidden = !nextUser;
  $("cloudAccount").hidden = !nextUser;
  $("cloudAccount").textContent = nextUser
    ? nextUser.user_metadata?.user_name || nextUser.user_metadata?.preferred_username || "已登录"
    : "";
  clearFilters();
  if (!nextUser) {
    syncEngine.deactivate();
    let local = localSnapshotAtStartup;
    try { const raw=localStorage.getItem(KEY); if(raw){const parsed=JSON.parse(raw);if(validState(parsed)){local=parsed;lastRaw=raw;}} } catch {}
    state = JSON.parse(JSON.stringify(local));
    render();
    $("saveStatus").textContent = persistent ? "本地模式" : "本次页面暂存";
    return;
  }
  // [account boundary] 先清空视图，再读取这个账号的数据，避免闪现上一份清单。
  state = emptyCloudState();
  render();
  await syncEngine.activate(nextUser.id);
}
function makeCloudFetch() {
  return async (url, options={}) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if(options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(abort,15000);
    try{return await fetch(url,{...options,signal:controller.signal});}
    finally{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);}
  };
}
async function setupCloud() {
  $("loginCloud").disabled = !cloudConfigured;
  if (!cloudConfigured) return;
  if (!window.supabase || !window.BudgetSyncEngine) {
    $("saveStatus").textContent="云同步未能启动";
    $("loginCloud").disabled=true;
    return;
  }
  cloudClient=window.supabase.createClient(CLOUD_CONFIG.url,CLOUD_CONFIG.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,
      storageKey:"double11-auth-"+new URL(CLOUD_CONFIG.url).hostname},
    global:{fetch:makeCloudFetch()}
  });
  syncEngine=new window.BudgetSyncEngine({
    storage:localStorage,prefix:"double11-cloud-v1:"+new URL(CLOUD_CONFIG.url).hostname+":",
    validate:validState,emptyState:emptyCloudState,
    onState:payload=>{state=payload;render();},onStatus:updateCloudStatus,
    readRemote:async userId=>{
      const {data,error}=await cloudClient.from("shopping_budgets").select("payload,revision,updated_at").eq("user_id",userId).maybeSingle();
      if(error)throw error;
      return data;
    },
    writeRemote:async({userId,payload,revision})=>{
      // [compare & swap] 只写入刚读取的版本；空结果按冲突处理，交回用户选择。
      const table=cloudClient.from("shopping_budgets");
      const request=revision===null
        ? table.insert({user_id:userId,payload,revision:0})
        : table.update({payload,revision:revision+1}).eq("user_id",userId).eq("revision",revision);
      const {data,error}=await request.select("revision").maybeSingle();
      if(error?.code==="23505")return {conflict:true};
      if(error)throw error;
      return data || {conflict:true};
    }
  });
  cloudClient.auth.onAuthStateChange((_event,session)=>{
    // [auth lock] 回调先返回，数据库读取留到下一轮，避免等待认证锁。
    setTimeout(()=>{void applyCloudSession(session).catch(()=>{
      $("saveStatus").textContent="登录状态读取失败";
    });},0);
  });
  const {data,error}=await cloudClient.auth.getSession();
  if(error){$("saveStatus").textContent="登录状态读取失败";return;}
  await applyCloudSession(data.session);
}
$("loginCloud").addEventListener("click",async()=>{
  if(!cloudClient)return;
  if(location.protocol==="file:")return toast("云同步请从已发布的网站地址登录，本地文件仍可离线使用");
  if(localUnsaved)return toast("当前有尚未保存的数据，请先导出备份再登录");
  const {error}=await cloudClient.auth.signInWithOAuth({provider:"github",options:{redirectTo:CLOUD_CONFIG.siteUrl}});
  if(error)toast("登录暂未完成，请检查 GitHub 登录配置后重试");
});
$("logoutCloud").addEventListener("click",async()=>{
  if(syncEngine?.entry?.dirty){
    if(!syncEngine.cached)return toast("尚有未保存的数据，请先导出备份并完成保存");
    if(!(await ask("还有未同步的修改，已暂存在本机此账号下。退出后不会立即上传，下次登录可继续同步。确定退出吗？")))return;
  }
  const {error}=await cloudClient.auth.signOut({scope:"local"});
  if(error)return toast("退出未完成，请重试");
  await applyCloudSession(null);
});
$("cloudRetry").addEventListener("click",()=>void syncEngine?.retry());
$("cloudExport").addEventListener("click",()=>$("exportData").click());
$("migrateLocal").addEventListener("click",async()=>{
  if(!syncEngine?.ready||syncEngine.loading||syncEngine.entry?.revision!==null)return;
  if(!(await ask(`将本浏览器原有的 ${localSnapshotAtStartup.items.length} 项商品及图片，上传到你当前登录账号的 Supabase 清单？`)))return;
  state=JSON.parse(JSON.stringify(localSnapshotAtStartup));commit("已导入本地清单");
});
$("useRemote").addEventListener("click",async()=>{
  if(!(await ask("加载云端清单？本地冲突版本会先保留在本浏览器的恢复副本中。建议同时导出 JSON 备份。")))return;
  if(!(await syncEngine.useRemote()))toast("未能保留本地恢复副本，请先导出备份再重试");
});
$("keepLocal").addEventListener("click",async()=>{
  if(!(await ask("用当前本地清单替换刚读取的云端版本？这会覆盖其他设备的这次修改。建议先导出并核对两份记录。")))return;
  await syncEngine.keepLocal();
});
window.addEventListener("online",()=>{if(syncEngine?.userId)void syncEngine.retry();});
window.addEventListener("focus",()=>{
  if(syncEngine?.userId&&!$("itemDialog").open&&!$("photoDialog").open&&!$("confirmDialog").open&&$("budgetForm").hidden)void syncEngine.refresh();
});
window.addEventListener("beforeunload",event=>{
  if(localUnsaved||syncEngine?.needsUnloadWarning()){event.preventDefault();event.returnValue="";}
});
void setupCloud().catch(()=>{ $("saveStatus").textContent="云同步未能启动 · 本地数据保留"; });
