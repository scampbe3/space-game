/* behaviours.js – all enemy movement/aim presets in one place */
import * as THREE from './libs/build/three.module.js';

export const BEHAVIOURS = {
  /* regular dark fighter */
  straight : {
    retreatDist : 50,
    fireDir     : +1,             // your dark bolts use +Z  :contentReference[oaicite:4]{index=4}
    despawnDelay: 20
  },

  /* blue cork-screw fighter */
  corkscrew : {
    yaw         : Math.PI,
    fireDir     : -1,
    orbitRadius : 4,
    orbitRate   : 3,
    retreatDist : 50,
    despawnDelay: 20
  },

  /* blue straight fighter (normal movement, blue mesh) */
  blueStraight : {
    yaw         : Math.PI,
    fireDir     : -1,
    retreatDist : 50,
    despawnDelay: 20
  },

  /* diagonal left→right drive-by */
  diagLR : {
    fireDir     : +1,
    diagSpeed   : 25,
    diagVec     : new THREE.Vector3( 1, -0.3, 0 ).normalize(),
    retreatDist : 70,
    despawnDelay: 20
  },

  /* mirrored right→left drive-by */
  diagRL : {
    fireDir     : +1,
    diagSpeed   : 25,
    diagVec     : new THREE.Vector3(-1,  0.3, 0 ).normalize(),
    retreatDist : 70,
    despawnDelay: 20
  },

/* ============================================================= */
/*  NEW BEHAVIOURS                                               */
/* ============================================================= */

/* 1. Wide lateral zig-zag (dark model) ------------------------ */
zigzagWide : {
  fireDir    : +1,
  lateralAmp : 18,          // 8-unit side sweep
  lateralHz  : 0.8,        // cycles per second
  retreatDist: 60,
  despawnDelay: 20
},

/* 2. Tight high-speed zig-zag (blue model) -------------------- */
zigzagTight : {
  yaw        : Math.PI,    // flip blue model
  fireDir    : -1,
  lateralAmp : 8,
  lateralHz  : 1,
  retreatDist: 55,
  despawnDelay: 20
},

/* 3. Hover-bob (vertical sine) -------------------------------- */
hoverBob : {
  yaw         : Math.PI,
  fireDir     : -1,
  verticalAmp : 15,
  verticalHz  : 1,
  retreatDist : 45,
  despawnDelay: 20
},

/* 4. Spiral-in cork-screw (dark) ------------------------------ */
spiralIn : {
  fireDir     : +1,
  orbitRadius : 16,
  orbitRate   : 2,         // fast spin while sliding back
  retreatDist : 40,
  despawnDelay: 20
},


 /* 5. Spider-Turret fighter (dark3) ------------------------ */
spiderTurret: {
  dualGun      : true,
  gunSpacing   : 0.6,
  fireInterval : 0.3,
  fireDir      : +1,

  lateralAmp   : 18,      // side-scuttle
  lateralHz    : 0.6,

  verticalAmp  : 8,      // subtle hover-bob
  verticalHz   : 0.4,

  retreatDist  : 50,     // a bit closer

backpedal : true,
hp           : 5,
  despawnDelay : 30
},

/* 6. Jet swoop (fast arcing passes) -------------------------- */
jetArc: {
  fireDir      : +1,
  fireOffsetZ  : 1.5,
  forwardAxis  : new THREE.Vector3(-1, 0, 0),
  hp           : 5,
  burstCount   : 5,
  burstInterval: 0.12,
  burstPause   : 2.0,
  passLoop     : true,
  passDuration : 7,
  passAhead    : 180,
  passBehind   : 8,
  passFireWindow: 70,
  orientToVelocity: true,
  orientToPlayerWhenFiring: true,
  glowOffset   : new THREE.Vector3(0.8, 0, 0),
  lateralAmp   : 16,
  lateralHz    : 0.45,
  verticalAmp  : 10,
  verticalHz   : 0.25,
  retreatDist  : 90,
  despawnDelay : 28
}




};
