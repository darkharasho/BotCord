import { useEffect } from 'react';
import { api } from '../lib/api';
import { openContextMenu, type ContextMenuEntry } from './ContextMenu';
import {
  IconScissors, IconCopy, IconClipboard, IconSelector,
  IconArrowBackUp, IconArrowForwardUp, IconBook2,
} from '@tabler/icons-react';

// Subscribes to the main process's `context-menu` forwarder and renders
// our themed ContextMenu for editable surfaces (textareas, inputs). Only
// mounted once at the app root.
export function SystemContextMenuListener() {
  useEffect(() => {
    return api.events.onSystemContextMenu(p => {
      const items: ContextMenuEntry[] = [];
      const iconCls = 'w-4 h-4 stroke-[1.75]';

      // Misspelled-word suggestions surface at the top, like Discord's menu.
      if (p.misspelledWord) {
        if (p.dictionarySuggestions.length === 0) {
          items.push({ type: 'item', label: 'No suggestions', onClick: () => {}, disabled: true });
        } else {
          for (const suggestion of p.dictionarySuggestions.slice(0, 5)) {
            items.push({
              type: 'item',
              label: suggestion,
              onClick: () => { void api.system.replaceMisspelling(suggestion); },
            });
          }
        }
        items.push({
          type: 'item',
          label: 'Add to Dictionary',
          icon: <IconBook2 className={iconCls} />,
          onClick: () => { void api.system.addToDictionary(p.misspelledWord); },
        });
        items.push({ type: 'separator' });
      }

      const editAction = (action: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo') =>
        () => { void api.system.editAction(action); };

      items.push({ type: 'item', label: 'Undo', icon: <IconArrowBackUp className={iconCls} />, onClick: editAction('undo'), disabled: !p.editFlags.canUndo });
      items.push({ type: 'item', label: 'Redo', icon: <IconArrowForwardUp className={iconCls} />, onClick: editAction('redo'), disabled: !p.editFlags.canRedo });
      items.push({ type: 'separator' });
      items.push({ type: 'item', label: 'Cut', icon: <IconScissors className={iconCls} />, onClick: editAction('cut'), disabled: !p.editFlags.canCut });
      items.push({ type: 'item', label: 'Copy', icon: <IconCopy className={iconCls} />, onClick: editAction('copy'), disabled: !p.editFlags.canCopy });
      items.push({ type: 'item', label: 'Paste', icon: <IconClipboard className={iconCls} />, onClick: editAction('paste'), disabled: !p.editFlags.canPaste });
      items.push({ type: 'separator' });
      items.push({ type: 'item', label: 'Select All', icon: <IconSelector className={iconCls} />, onClick: editAction('selectAll'), disabled: !p.editFlags.canSelectAll });

      // Synthesize a click event for our shared opener.
      openContextMenu({ preventDefault: () => {}, clientX: p.x, clientY: p.y }, items);
    });
  }, []);

  return null;
}
