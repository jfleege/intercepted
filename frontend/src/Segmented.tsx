import {useLayoutEffect, useRef} from 'react';
import type {ComponentPropsWithoutRef} from 'react';

export default function Segmented({className = '', children, ...props}: ComponentPropsWithoutRef<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = ref.current!;
    const update = () => {
      const selected = group.querySelector<HTMLElement>(':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]');
      group.style.setProperty('--selection-left', `${selected?.offsetLeft ?? 0}px`);
      group.style.setProperty('--selection-top', `${selected?.offsetTop ?? 0}px`);
      group.style.setProperty('--selection-width', `${selected?.offsetWidth ?? 0}px`);
      group.style.setProperty('--selection-height', `${selected?.offsetHeight ?? 0}px`);
    };
    const resize = new ResizeObserver(update);
    const observeButtons = () => {
      resize.disconnect();
      resize.observe(group);
      for (const button of group.querySelectorAll(':scope > button')) resize.observe(button);
      update();
    };
    const mutation = new MutationObserver(observeButtons);
    mutation.observe(group, {subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected']});
    observeButtons();
    return () => { resize.disconnect(); mutation.disconnect(); };
  }, []);
  return <div {...props} ref={ref} className={`ic-segmented ${className}`}>{children}</div>;
}
