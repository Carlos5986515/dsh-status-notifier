/**
 * Client half of the status-notifier bundle.
 *
 * No in-window UI anymore (the menu bar item owns the status surface). This
 * half only fires system notifications while the page is alive but the user
 * is away (window hidden or unfocused), for two events:
 *   1. a permission request appears (kind 'approval' pending interaction),
 *   2. a session finished while it was not the main view (completionUnread).
 * The Host half covers the window-closed case, so the two never double-alert.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-status-notifier',
  factory(require) {
    const NS = 'status-notifier';

    const zh = {
      untitled: '未命名会话',
      'row.toolUnknown': '正在等待批准',
      'notify.approval.title': 'DeepSeek Harness · 需要批准',
      'notify.approval.body': '会话「{title}」中的 {tool} 正在等待你的批准',
      'notify.done.title': 'DeepSeek Harness · 任务完成',
      'notify.done.body': '会话「{title}」已完成，可以回来查看结果了',
    };

    const en = {
      untitled: 'Untitled session',
      'row.toolUnknown': 'Waiting for approval',
      'notify.approval.title': 'DeepSeek Harness · Approval needed',
      'notify.approval.body': '{tool} in “{title}” is waiting for your approval',
      'notify.done.title': 'DeepSeek Harness · Task finished',
      'notify.done.body': '“{title}” finished — come back to review the results',
    };

    function awayFromPage() {
      try {
        if (typeof document === 'undefined') return false;
        if (document.visibilityState !== 'visible') return true;
        if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
      } catch (error) {}
      return false;
    }

    function fireNotification(title, body, sessionId, openSession) {
      try {
        const notification = new Notification(title, { body: body || '' });
        notification.onclick = () => {
          try { window.focus(); } catch (error) {}
          if (sessionId && openSession) {
            try { openSession(sessionId); } catch (error) {}
          }
          notification.close();
        };
      } catch (error) {
        // Notification API unavailable or denied; the menu bar item still shows.
      }
    }

    function sessionTitle(row, t) {
      if (row && typeof row.title === 'string' && row.title.length > 0) return row.title;
      return t('untitled');
    }

    return {
      name: 'status-notifier',
      inject: ['locale', 'sessions', 'uiSession'],
      apply(ctx) {
        const statusSource = ctx.uiSession.sessionStatus;
        const sessionsStore = ctx.sessions.list;
        const uiWorkspace = ctx.get('uiWorkspace');

        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'status-notifier: zh dictionary');
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'status-notifier: en dictionary');

        const t = ctx.locale.bind(NS);
        const openSession = (sessionId) => {
          if (!uiWorkspace || typeof uiWorkspace.openSession !== 'function') return;
          try {
            uiWorkspace.openSession(sessionId);
          } catch (error) {}
        };

        const knownApprovals = new Set();
        const knownCompletions = new Set();

        const check = () => {
          if (!awayFromPage()) return;
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
          const statusMap = statusSource.getSnapshot();
          const byId = sessionsStore.getSnapshot().byId || {};

          const approvals = [];
          const completions = [];
          statusMap.forEach((status, sessionId) => {
            const interaction = status.pendingInteraction;
            if (interaction && interaction.kind === 'approval') approvals.push({ sessionId, interaction });
            if (status.completionUnread) completions.push(sessionId);
          });

          const approvalKeys = new Set(approvals.map((entry) => entry.sessionId + ':' + entry.interaction.key));
          for (const entry of approvals) {
            const key = entry.sessionId + ':' + entry.interaction.key;
            if (knownApprovals.has(key)) continue;
            knownApprovals.add(key);
            fireNotification(
              t('notify.approval.title'),
              t('notify.approval.body', {
                title: sessionTitle(byId[entry.sessionId], t),
                tool: entry.interaction.toolName || t('row.toolUnknown'),
              }),
              entry.sessionId,
              openSession,
            );
          }
          knownApprovals.clear();
          for (const key of approvalKeys) knownApprovals.add(key);

          const completionKeys = new Set(completions);
          for (const sessionId of completions) {
            if (knownCompletions.has(sessionId)) continue;
            knownCompletions.add(sessionId);
            fireNotification(
              t('notify.done.title'),
              t('notify.done.body', { title: sessionTitle(byId[sessionId], t) }),
              sessionId,
              openSession,
            );
          }
          knownCompletions.clear();
          for (const key of completionKeys) knownCompletions.add(key);
        };

        const dispose = statusSource.subscribe(check);
        ctx.effect(() => dispose, 'status-notifier: notification watch');
      },
    };
  },
});
