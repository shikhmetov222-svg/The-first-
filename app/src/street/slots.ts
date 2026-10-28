// Слоты бизнесов на улице: здания нужного уровня, стройка при улучшении, тап по зданию.
// Логика стройки — setLevel() из docs/street-mockup.js, без изменений по смыслу.
import * as THREE from 'three';
import { createTypes } from './gen/types.js';
import { createAnim } from './gen/anim.js';
import type { World } from './world';
import { mergeStatic } from './merge';

import { SLOT_TYPES, type GameType, type SlotView } from './views';

export type { GameType, SlotView };

interface Slot {
  game: GameType;
  street: string;
  x: number;
  level: number;
  lotPct: number | null;
  group: THREE.Group;
  busy: boolean;
  pending: SlotView | null; // пришло новое, пока шла стройка
}

export function createSlots(world: World, scene: THREE.Scene, reduce: boolean) {
  const types = createTypes(world.k);
  const anim = createAnim(world.k, scene);
  /** Здание из макета; его неподвижные детали склеиваются в несколько мешей. */
  const make = (street: string, L: number, pct: number | null): THREE.Group => {
    const g = types.makeFor(street, L, pct ?? 0);
    // Чужой участок: на табличке только «ПРОДАЁТСЯ», без чужих денег.
    if (L === 0 && pct === null)
      g.traverse((o: THREE.Object3D) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (m?.type === 'MeshBasicMaterial' && m.map) m.map = world.k.signTex(['ПРОДАЁТСЯ'], '#D4A73A', 512, 220);
      });
    mergeStatic(g, world.mutable);
    return g;
  };

  const slots: Slot[] = SLOT_TYPES.map((t) => {
    const group = make(t.street, 0, 0);
    group.position.x = t.x;
    scene.add(group);
    return { game: t.game, street: t.street, x: t.x, level: 0, lotPct: 0, group, busy: false, pending: null };
  });

  function swap(slot: Slot, L: number, pct: number | null) {
    const ng = make(slot.street, L, pct);
    ng.position.x = slot.x;
    scene.add(ng);
    slot.group = ng;
    slot.level = L;
    slot.lotPct = pct;
    return ng;
  }

  function finish(slot: Slot) {
    slot.busy = false;
    if (slot.pending) {
      const p = slot.pending;
      slot.pending = null;
      setLevel(slot, p, false);
    }
  }

  /** Сменить здание. animate — стройка как в макете (старое уходит → леса, кран, пыль → новое вырастает). */
  function setLevel(slot: Slot, view: SlotView, animate: boolean, onBuilt?: () => void) {
    const L = view.level;
    const pct = L === 0 ? view.lotPct : 0;
    if (slot.busy) {
      slot.pending = view;
      return;
    }
    if (L === slot.level && (L > 0 || pct === slot.lotPct)) return;
    const old = slot.group;
    const up = L > slot.level;
    if (!animate || !up) {
      scene.remove(old);
      types.disposeGroup(old);
      swap(slot, L, pct);
      return;
    }
    slot.busy = true;
    const build = (grow: boolean) => {
      const ng = swap(slot, L, pct);
      onBuilt?.();
      if (!grow) {
        finish(slot);
        return;
      }
      ng.scale.set(0.9, 0.01, 0.9);
      anim.tween(
        reduce ? 0.2 : 0.7,
        (p: number) => {
          const e = reduce ? p : anim.easeOutBack(p);
          ng.scale.set(0.9 + 0.1 * p, Math.max(0.01, e), 0.9 + 0.1 * p);
        },
        () => finish(slot),
      );
    };
    if (reduce) {
      scene.remove(old);
      types.disposeGroup(old);
      build(false);
      return;
    }
    anim.tween(
      0.35,
      (p: number) => {
        old.scale.y = Math.max(0.01, 1 - p);
      },
      () => {
        scene.remove(old);
        types.disposeGroup(old);
        const sc = anim.scaffold(types.dimsFor(slot.street, L));
        sc.position.x = slot.x;
        sc.scale.y = 0.01;
        scene.add(sc);
        anim.tween(0.5, (p: number) => {
          sc.scale.y = Math.max(0.01, p);
        });
        anim.dust(slot.x);
        anim.tween(
          1.5,
          (p: number) => {
            sc.userData.arm.rotation.y = p * Math.PI * 1.1;
          },
          () => {
            scene.remove(sc);
            types.disposeGroup(sc);
            build(true);
          },
        );
      },
    );
  }

  /** Применить данные сервера. Первый раз — без анимации. */
  function apply(views: Record<GameType, SlotView>, animate: boolean, onBuilt?: (game: GameType) => void) {
    slots.forEach((s) => {
      const v = views[s.game];
      if (v) setLevel(s, v, animate, () => onBuilt?.(s.game));
    });
  }

  const raycaster = new THREE.Raycaster();
  /** Какое здание под пальцем (координаты экрана −1…1). */
  function pick(ndc: THREE.Vector2, camera: THREE.Camera): Slot | null {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(slots.map((s) => s.group), true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o) {
      const s = slots.find((sl) => sl.group === o);
      if (s) return s;
      o = o.parent;
    }
    return null;
  }

  /** Каждый кадр: твины, анимации зданий (конвейеры, краны, экраны), огонь в печи. */
  function update(clock: number, dt: number) {
    const tw = anim.tweens;
    for (let i = tw.length - 1; i >= 0; i--) {
      const t = tw[i];
      t.t += dt;
      const p = Math.min(1, t.t / t.dur);
      t.fn(p);
      if (p >= 1) {
        tw.splice(i, 1);
        if (t.done) t.done();
      }
    }
    slots.forEach((s) => (s.group.userData.anims || []).forEach((fn: (t: number, d: number) => void) => fn(clock, dt)));
    slots.forEach((s) =>
      (s.group.userData.flicker || []).forEach((m: THREE.MeshBasicMaterial, i: number) => {
        m.color.setRGB(1, 0.42 + 0.1 * Math.sin(clock * 11 + i * 2) + 0.05 * Math.sin(clock * 23), 0.12);
      }),
    );
  }

  return { slots, types, anim, apply, pick, update };
}

export type Slots = ReturnType<typeof createSlots>;
