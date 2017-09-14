import { Injectable } from '@angular/core';

import { Subscription } from 'rxjs/Subscription';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/interval';

import { AppSettingsService } from './app-settings.service';
import { SignalKService } from './signalk.service';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';



interface dataPoint {
  timestamp: number;
  average: number;
  minValue: number;
  maxValue: number;
}

interface dataCache {
  runningTotal: number;
  numberOfPoints: number;
  minValue: number;
  maxValue: number;
}

interface dataSet {
  uuid: string;
  path: string;
  pathSub: Subscription;
  signalKSource: string;

  updateTimer: number; //number of seconds between new dataPoints
  updateTimerSub: Subscription;
   
  dataPoints: number // how many datapoints do we keep?

  data: dataPoint[];
  dataCache: dataCache // running calculations
   
};

interface registration {
  uuid: string;
  dataSetUuid: string;
  observable: BehaviorSubject<Array<dataPoint>>;
}

@Injectable()
export class DataSetService {

  dataSets: dataSet[] = [];
  dataSetRegister: registration[] = [];

  constructor(
    private AppSettingsService: AppSettingsService,
    private SignalKService: SignalKService,
  ) { 
    //this.loadSubs();
    
        // start existing subscriptions
        for (let i = 0; i < this.dataSets.length; i++) {
           this.startDataSet(this.dataSets[i].uuid);
        }
  }

  private newUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
  }

  subscribeDataSet(uuid, dataSetUuid) {
    //see if already subscribed, if yes return that...
    let registerIndex = this.dataSetRegister.findIndex(registration => (registration.uuid == uuid) && (registration.dataSetUuid = dataSetUuid));
    if (registerIndex >= 0) { // exists
      return this.dataSetRegister[registerIndex].observable.asObservable();
    }
    

    //find if we already have a value for this dataSet to return.
    let currentDataSet: dataPoint[];
    let dataIndex = this.dataSets.findIndex(dataSet => dataSet.uuid == dataSetUuid);
    if (dataIndex >= 0) { // exists
      currentDataSet = this.dataSets[dataIndex].data;
    } else {
      currentDataSet = null;
    }

    //register
    this.dataSetRegister.push({
      uuid: uuid,
      dataSetUuid: dataSetUuid,
      observable: new BehaviorSubject<Array<dataPoint>>(currentDataSet)
    });
    // should be subscribed now, use search now as maybe someone else adds something and it's no longer last in array :P
    registerIndex = this.dataSetRegister.findIndex(registration => (registration.uuid == uuid) && (registration.dataSetUuid = dataSetUuid));
    return this.dataSetRegister[registerIndex].observable.asObservable();
  }

  startDataSet(uuid: string) {
    let dataIndex = this.dataSets.findIndex(dataSet => dataSet.uuid == uuid);
    if (dataIndex < 0) { return; }//not found...

    // initialize data
    this.dataSets[dataIndex].data = [];
    for (let i=0; i<this.dataSets[dataIndex].dataPoints; i++) {
        this.dataSets[dataIndex].data.push(null);
    }
    
    // inistialize dataCache
    this.dataSets[dataIndex].dataCache = {
        runningTotal: 0,
        numberOfPoints: 0,
        minValue: null,
        maxValue: null           
    }
    
    //Subscribe to path data
    this.dataSets[dataIndex].pathSub = this.SignalKService.subscribePath(this.dataSets[dataIndex].uuid, this.dataSets[dataIndex].path).subscribe(
      pathObject => {
        if (pathObject === null) {
          return; // we will get null back if we subscribe to a path before the app knows about it. when it learns about it we will get first value
        }
        let source: string;
        if (this.dataSets[dataIndex].signalKSource == 'default') {
          source = pathObject.defaultSource;
        } else {
          source = this.dataSets[dataIndex].signalKSource;
        }
        this.updateDataCache(uuid, pathObject.sources[source].value);
    });
    
    // start update timer
    this.dataSets[dataIndex].updateTimerSub = Observable.interval (1000 * this.dataSets[dataIndex].updateTimer).subscribe(x => {
        this.aggregateDataCache(this.dataSets[dataIndex].uuid);
    });

  }

  addDataSet(path: string, source: string, updateTimer: number, dataPoints: number ) {
    let uuid = this.newUuid();

    let newSub: dataSet = {
      uuid: uuid,
      path: path,
      pathSub: null,

      signalKSource: source,

      updateTimer: updateTimer,
      updateTimerSub: null,
      
      dataPoints: dataPoints,

      data: null,
      dataCache: null   
    };
    this.dataSets.push(newSub);

    this.startDataSet(uuid);
  }

  deleteSubscription(uuid: string) {
    //get index
    let dataSetIndex = this.dataSets.findIndex(sub => sub.uuid == uuid);
    if (dataSetIndex < 0) { return; } // uuid doesn't exist...

    //stop timer
    this.dataSets[dataSetIndex].updateTimerSub.unsubscribe();
    //stop pathSub
    this.dataSets[dataSetIndex].pathSub.unsubscribe();


    // deleteSubscription
    this.dataSets.splice(dataSetIndex,1);

  }

  aggregateDataCache(uuid: string) {
    let avg: number = null;

    //get index
    let dsIndex = this.dataSets.findIndex(sub => sub.uuid == uuid);

    // update average
    if (this.dataSets[dsIndex].dataCache.numberOfPoints > 0) { // if it's still 0, we had no update this timeperiod so leave it as null...
      avg = this.dataSets[dsIndex].dataCache.runningTotal / this.dataSets[dsIndex].dataCache.numberOfPoints;
    }

    // remove first item
    this.dataSets[dsIndex].data.shift();

    // add our new dataPoint to end of dataset.
    let newDataPoint: dataPoint = {
      timestamp: Date.now(),
      average: avg,
      minValue: this.dataSets[dsIndex].dataCache.minValue,
      maxValue: this.dataSets[dsIndex].dataCache.maxValue
    }
    this.dataSets[dsIndex].data.push(newDataPoint);

    // reset dataCache
    this.dataSets[dsIndex].dataCache = {
          runningTotal: 0,
          numberOfPoints: 0,
          minValue: null,
          maxValue: null           
      }       
    // ... push to registered graphs...
  }

  updateDataCache(uuid: string, newValue: number) {
    //get index
    let dsIndex = this.dataSets.findIndex(sub => sub.uuid == uuid);

    this.dataSets[dsIndex].dataCache.runningTotal = this.dataSets[dsIndex].dataCache.runningTotal + newValue;
    this.dataSets[dsIndex].dataCache.numberOfPoints = this.dataSets[dsIndex].dataCache.numberOfPoints + 1;

    if ((this.dataSets[dsIndex].dataCache.minValue === null) || (this.dataSets[dsIndex].dataCache.minValue > newValue)) {
      this.dataSets[dsIndex].dataCache.minValue = newValue;
    }
    if ((this.dataSets[dsIndex].dataCache.maxValue === null) || (this.dataSets[dsIndex].dataCache.maxValue < newValue)) {
      this.dataSets[dsIndex].dataCache.maxValue = newValue;
    }
  }

}
