import { useState, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Scatter } from 'react-chartjs-2'
import './App.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

interface ApiResponse {
  message: string
}

interface DataPoint {
  x: number
  y: number
}

interface ChartData {
  data: DataPoint[]
  title: string
  x_title: string
  y_title: string
}

function App() {
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch both hello message and chart data
    Promise.all([
      fetch('/api/hello').then(response => response.json()),
      fetch('/api/data').then(response => response.json())
    ])
      .then(([helloData, dataResponse]) => {
        setApiData(helloData)
        setChartData(dataResponse)
        setLoading(false)
      })
      .catch(error => {
        console.error('Error:', error)
        setLoading(false)
      })
  }, [])

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: chartData?.title || 'Hello world!',
        font: {
          size: 20
        }
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: chartData?.x_title || 'Apps'
        }
      },
      y: {
        display: true,
        title: {
          display: true,
          text: chartData?.y_title || 'Fun with data'
        }
      }
    }
  }

  const scatterData = {
    datasets: [
      {
        data: chartData?.data || [],
        backgroundColor: 'rgba(255, 99, 132, 0.8)',
        borderColor: 'rgba(255, 99, 132, 1)',
        pointRadius: 4,
      },
    ],
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>🚀 Node.js + FastAPI Hello World</h1>
        
        {loading ? (
          <p>Loading...</p>
        ) : (
          <div className="content">
            {apiData ? (
              <div className="api-info">
                <p className="message">{apiData.message}</p>
              </div>
            ) : (
              <p>Failed to connect to API</p>
            )}
            
            {chartData && (
              <div className="chart-container">
                <Scatter data={scatterData} options={chartOptions} />
              </div>
            )}
          </div>
        )}
      </header>
    </div>
  )
}

export default App 