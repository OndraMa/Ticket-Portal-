// Only the Worker URL is public. No Microsoft token or portal password belongs here.
window.TicketCloud = (() => {
  let token = '', version = '', snapshot = null, blocked = false;
  const url = () => {
    const value = window.TICKET_CLOUD_API;
    if (!value || !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value))
      throw new Error('Cloud ještě není připojen. Správce musí nastavit adresu serveru.');
    return value;
  };
  async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    const response = await fetch(url() + path, {...options,headers,cache:'no-store',credentials:'omit'});
    if (!response.ok) {
      let message = 'Server operaci nepotvrdil.';
      try {message = (await response.json()).error || message;} catch {}
      if (response.status === 401 && path !== '/api/login') {
        token = ''; sessionStorage.removeItem('ticket-cloud-session');
      }
      throw new Error(message);
    }
    return response;
  }
  async function load() {
    snapshot = await (await api('/api/state')).json();
    version = snapshot.version;
    return structuredClone(snapshot);
  }
  async function login(password) {
    token = (await (await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password})})).json()).token;
    sessionStorage.setItem('ticket-cloud-session',token);
    return load();
  }
  async function resume() {
    token = sessionStorage.getItem('ticket-cloud-session') || '';
    if (!token) return null;
    try {return await load();} catch(error) {logout(); throw error;}
  }
  function logout() {token='';sessionStorage.removeItem('ticket-cloud-session');}
  async function save(servis,dily) {
    if (blocked) throw new Error('Před dalším ukládáním obnov stránku. Předchozí operace nebyla potvrzena.');
    try {
      const result=await (await api('/api/state',{method:'PUT',
        headers:{'Content-Type':'application/json','X-Portal-Version':version},
        body:JSON.stringify({servis,dily})})).json();
      version=result.version;
      snapshot={servis:structuredClone(servis),dily:structuredClone(dily),version};
    } catch(error) {blocked=true;throw error;}
  }
  class Directory {
    constructor(path='') {this.path=path;this.name=path||'OneDrive';}
    async getDirectoryHandle(name,options={}) {
      if(this.path) throw new Error('Vnořené složky nejsou podporovány.');
      if(options.create) await api('/api/directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:name})});
      return new Directory(name);
    }
    async getFileHandle(name) {
      if(!this.path) throw new Error('Záznamy se ukládají přes cloudovou databázi.');
      const path=this.path+'/'+name;
      return {
        name,
        async getFile() {
          const response=await api('/api/file?path='+encodeURIComponent(path));
          return new File([await response.blob()],name,{type:response.headers.get('Content-Type')||''});
        },
        async createWritable() {
          let blob;
          return {
            async write(value) {
              blob=value instanceof Blob ? value : new Blob([value]);
              if(blob.size>25*1024*1024) throw new Error('Příloha může mít nejvýše 25 MB.');
            },
            async close() {
              if(!blob) throw new Error('Prázdný zápis.');
              await api('/api/file?path='+encodeURIComponent(path),{method:'PUT',body:blob});
            }
          };
        }
      };
    }
    async removeEntry(name) {
      await api('/api/directory?path='+encodeURIComponent(name),{method:'DELETE'});
    }
  }
  function pickFiles(accept='') {
    return new Promise(resolve=>{
      const input=document.createElement('input');
      input.type='file';input.multiple=true;input.accept=accept;input.hidden=true;
      const done=files=>{input.remove();resolve(Array.from(files, file=>({name:file.name,getFile:async()=>file})));};
      input.addEventListener('change',()=>done(input.files),{once:true});
      input.addEventListener('cancel',()=>done([]),{once:true});
      document.body.appendChild(input);input.click();
    });
  }
  return {login,resume,logout,save,Directory,pickFiles,
    initial(name){return structuredClone(name==='servisni.json'?snapshot.servis:snapshot.dily);},
    previous(){return structuredClone(snapshot);}
  };
})();
