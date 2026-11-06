import { mountWorkbench } from '../ui/workbench.mjs';
import styles from '../ui/workbench.css';
import observation from '../browser/observations.json';

const id = '@xatp/workbench';
const kind = 'xatp';
window.__ModuleLoader__.load({
  id,
  factory(require) {
    const React = require('react');
    return {
      inject:['slots','locale','sidebarRightTabs'],
      apply(ctx) {
        const title = () => 'XATP';
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id,kind,title,keepMounted:true,guide:[{id:'workbench',order:35,title}],
        }));
        ctx.effect(() => {
          const sheet = document.createElement('style');
          sheet.textContent = styles;
          document.head.append(sheet);
          return () => sheet.remove();
        });
        const subscribeLocale = listener => ctx.locale.subscribe(listener);
        const activeLocale = () => ctx.locale.getSnapshot().active;
        function Panel() {
          const root = React.useRef(null);
          const locale = React.useSyncExternalStore(subscribeLocale, activeLocale);
          React.useEffect(() => {
            const abort = new AbortController();
            const call = method => async (args = {}) => {
              const response = await fetch('api/xatp.' + method, {
                method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(args), signal:abort.signal,
              });
              const value = await response.json();
              if (!response.ok) throw new Error(value.error || 'XATP_REQUEST_FAILED');
              return value;
            };
            const workbench = mountWorkbench(root.current, {
              locale, observation, read:call('read'), listTabs:call('listTabs'), discover:call('discover'),
              inspect:call('inspect'),editPrompt:call('editPrompt'),
              previewURL:hash => 'api/xatp.preview?digest=' + encodeURIComponent(hash),
            });
            return () => { abort.abort(); workbench.destroy(); };
          }, [locale]);
          return React.createElement('div', {ref:root,'data-xatp-pane':'',style:{height:'100%',overflow:'auto',minWidth:0}});
        }
        for (const [name,component] of [['sidebar.right.pane.tab',Panel],['sidebar.right.pane.tab.title',title]]) {
          ctx.effect(() => ctx.slots.inject(name, () => ctx.slots.register({name,key:id},component)));
        }
      },
    };
  },
});
