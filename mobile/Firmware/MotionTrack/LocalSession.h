#pragma once
#include "WorkoutWire.h"
#include "ExerciseFlow.h"

// One workout persists through a BLE disconnect. Hardware samples advance ExerciseFlow.
struct LocalSession {
    workout::Stage resting = workout::Idle;
    uint8_t movement = 0, target = 0, before = 0, after = 0;
    uint32_t began = 0, elapsed = 0;
    bool timing = false;
    workout::Stage stage(const ExerciseFlow& f) const {
        if (!timing) return resting;
        switch (f.phase()) {
            case Phase::BeforeBpm: return workout::Before;
            case Phase::Counting: return workout::Counting;
            case Phase::AfterBpm: return workout::After;
            default: return workout::Complete;
        }
    }
    void finish(uint32_t now, bool completed) {
        elapsed = (now-began)/1000;
        resting = completed ? workout::Complete : workout::Stopped;
        timing = false;
    }
    bool start(ExerciseFlow& f, const workout::Command& c, uint32_t now) {
        if (timing || c.op!=1 || c.expected!=resting) return false;
        f = ExerciseFlow{};
        ServerWorkout s{};
        s.present = s.reps = true;
        s.id[0]='L';
        s.target = c.target;
        s.phase = Phase::BeforeBpm;
        f.sync(s,0);
        target=c.target; movement=c.movement;
        before=after=0; elapsed=0; began=now; timing=true;
        return true;
    }
    void command(ExerciseFlow& f, const workout::Command& c, uint32_t count, uint32_t now) {
        if (!timing || c.expected!=stage(f)) return;
        if (c.op==2) {
            finish(now,false);
        } else if (c.op==3 && f.phase()==Phase::BeforeBpm) {
            f.onBeforeBpmSaved(count);
        } else if (c.op==3 && f.phase()==Phase::AfterBpm) {
            f.onAfterBpmSaved(); finish(now,true);
        }
    }
    workout::Packet snapshot(const ExerciseFlow& f, uint32_t now, uint8_t flags, uint8_t capture) const {
        return workout::packet(stage(f),f.reps(),timing?(now-began)/1000:elapsed,movement,target,flags,before,after,capture);
    }
};
