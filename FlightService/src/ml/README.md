# ML Price Prediction Model

## 📊 Model Performance

- **Model Type:** RandomForest Regressor
- **R² Score:** 0.977 (97.7% variance explained)
- **MAE:** $31.40 (Mean Absolute Error)
- **RMSE:** $45.27 (Root Mean Squared Error)
- **Confidence:** 95% (dynamic, adjusts based on route knowledge)

## 🚀 Training the Model

### Option 1: Use Real Kaggle Dataset

1. Download dataset from:
   - https://www.kaggle.com/datasets/shubhambathwal/flight-price-prediction
   - https://www.kaggle.com/datasets/dilwong/flightprices

2. Save as `flight_prices.csv` in this directory

3. Run training:
```bash
python3 train_model_improved.py
```

### Option 2: Use Synthetic Data (Current)

The model is trained on 10,000 synthetic samples that simulate real flight pricing patterns:

```bash
python3 train_model_improved.py
```

## 📈 Features Used

1. **Duration** (minutes) - Primary price driver
2. **Departure Hour** (0-23) - Peak hours cost more
3. **Day of Week** (0-6) - Weekends cost more
4. **Month** (0-11) - Busy months (Dec, Jan, Jul, Aug) cost more
5. **Days Advance** - Last minute flights cost more
6. **Is Direct** - Direct flights cost more
7. **Is International** - International flights cost more
8. **Is Weekend** - Weekend flights cost more
9. **Is Peak Hour** - Peak hours (6-9am, 5-8pm) cost more
10. **Is Busy Month** - Holiday seasons cost more
11. **Is Major Hub** - Hub airports cost more
12. **Distance** (km) - Longer routes cost more

## 🎯 Generating Sample Flights

Generate realistic sample flight data for testing:

```bash
node generate_sample_flights.js 200 > sample_flights.json
```

This generates 200 sample flights with:
- Realistic routes (IST-DXB, JFK-LAX, etc.)
- Random dates in next 90 days
- Appropriate capacities (120-350 seats)
- Realistic durations based on route distances

## 📝 Model Updates

The model coefficients are automatically loaded from `model_coefficients.json` when available. To update:

1. Train new model: `python3 train_model_improved.py`
2. Restart flight-service
3. New coefficients will be loaded automatically

## 🔧 Improving the Model

To improve accuracy:

1. **Add Real Dataset:** Download from Kaggle and place as `flight_prices.csv`
2. **More Features:** Add airline, aircraft type, route popularity
3. **More Data:** Increase `n_samples` in `train_model_improved.py`
4. **Better Models:** Try XGBoost, Neural Networks
5. **Hyperparameter Tuning:** Optimize RandomForest parameters

## 📊 Current Model Stats

- **Training Samples:** 10,000 (synthetic)
- **Test Split:** 20%
- **Best Model:** RandomForest (100 trees, max_depth=10)
- **Training Time:** ~2 seconds
- **Prediction Time:** <1ms
