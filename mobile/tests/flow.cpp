#include "LocalSession.h"
#include <cassert>
#include <cstdio>
int main() {
    LocalSession s;
    ExerciseFlow f;
    workout::Command c;
    for (uint8_t mode : workout::modes) {
        uint8_t start[] = {1,1,mode,2,uint8_t(s.resting)};
        assert(workout::decode(start,5,c) && s.start(f,c,1000));
        assert(!s.start(f,c,1200));
        assert(f.phase()==Phase::BeforeBpm);
        s.before=76; f.onBeforeBpmSaved(80);
        assert(f.onRep(81)==1 && f.onRep(82)==2 && f.phase()==Phase::AfterBpm);
        // A delayed skip intended for before must not skip the after check.
        s.command(f,{3,0,0,workout::Before},82,6500);
        assert(s.stage(f)==workout::After);
        s.after=98; f.onAfterBpmSaved(); s.finish(8000,true);
        auto packet=s.snapshot(f,25000,0,0);
        assert(std::fwrite(packet.data(),1,packet.size(),stdout)==packet.size());
    }
    assert(s.start(f,{1,4,10,workout::Complete},30000));
    s.command(f,{3,0,0,workout::Before},50,31000);
    assert(f.onRep(51)==1);
    s.command(f,{2,0,0,workout::Counting},51,33000);
    auto stopped=s.snapshot(f,70000,0,0);
    assert(stopped[11]==workout::Stopped && stopped[2]==1 && stopped[4]==3 && stopped[14]==0);
    uint8_t bad[]={1,1,2,20,0}; assert(!workout::decode(bad,5,c));
    assert(!workout::decode(bad,4,c));
}
